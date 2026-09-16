import { SYMBOL_LABELS, PIP_SIZES } from './makoti-ws';
import { sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface Candle {
    open: number; high: number; low: number; close: number; time: number;
}

export interface Bollinger {
    upper: number;
    middle: number;
    lower: number;
}

export interface BbTouch {
    side: 'upper' | 'lower';
    bb: Bollinger;
    candle: Candle;
}

export interface TickPattern {
    side: 'upper' | 'lower' | null;
    streak: number;
    awaitingReversal: boolean;
    candleTime: number;
}

export interface TradeRecord {
    time: string;
    symbol: string;
    direction: 'RUNHIGH' | 'RUNLOW';
    stake: number;
    duration: number;
    entryPrice: number;
    exitPrice: number;
    profit: number;
    won: boolean;
}

export interface HighLowConfig {
    stake: number;
    maxConsecutiveLosses: number;
    dailyProfitTarget: number;
    dailyStopLoss: number;
    martingale: number;
    martingaleEnabled: boolean;
    useCompounding: boolean;
}

export const DEFAULT_CONFIG: HighLowConfig = {
    stake: 1,
    maxConsecutiveLosses: 3,
    dailyProfitTarget: 50,
    dailyStopLoss: -25,
    martingale: 2,
    martingaleEnabled: false,
    useCompounding: false,
};

/* ── Constants ──────────────────────────────────────────────────────────────── */

export const HL_SYMBOLS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
];
// 5000 ticks = ~83 min of 1s-volatility data = enough for 20+ 1-minute candles
// (Bollinger Bands need 21 candles before any touch can be detected).
export const MAX_TICKS = 5000;
export const HISTORY_COUNT = 5000;
export const MIN_TICKS = 30;
export const CANDLE_INTERVAL_S = 60; // 1-minute candles
export const BB_PERIOD = 20;
export const BB_MULT = 2;
export const MIN_STREAK = 3; // 3+ consecutive ticks in the band-side direction
export const TRADE_DURATION = 2; // 2-tick contracts

/* ══════════════════════════════════════════════════════════════════════════════
   BOLLINGER BAND ENGINE (same indicator as Deriv)

   Bands are computed exactly like Deriv's Bollinger Bands indicator:
   - middle band = SMA(period) of candle closes
   - standard deviation = population std-dev (divide by n)
   - upper = middle + stddev * mult, lower = middle - stddev * mult
   - defaults: period 20, multiplier 2

   Strategy:
   1. Watch every symbol's 1-minute candles (built from the live tick stream).
   2. Select symbols whose current candle TOUCHES the upper or lower band.
   3. Upper band touch -> wait for 3+ consecutive ticks UP, then one reversal
      tick DOWN -> fire RUNLOW (ONLY DOWNS) 2-tick contract.
   4. Lower band touch -> wait for 3+ consecutive ticks DOWN, then one reversal
      tick UP -> fire RUNHIGH (ONLY UPS) 2-tick contract.
   One trade at a time.
   ══════════════════════════════════════════════════════════════════════════════ */

/* ── Indicator math ─────────────────────────────────────────────────────────── */

function sma(values: number[], period: number): number {
    if (values.length < period) return values.length > 0 ? values[values.length - 1] : 0;
    let sum = 0;
    for (let i = values.length - period; i < values.length; i++) sum += values[i];
    return sum / period;
}

function stddev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const sqDiffs = values.map(v => (v - mean) ** 2);
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/** Deriv-style Bollinger Bands over the last `period` closes (population std-dev, ×`mult`). */
export function calcBollinger(closes: number[], period = BB_PERIOD, mult = BB_MULT): Bollinger | null {
    if (closes.length < period) return null;
    const window = closes.slice(-period);
    const middle = sma(window, period);
    const sd = stddev(window, middle);
    return { upper: middle + sd * mult, middle, lower: middle - sd * mult };
}

/* ── 1-minute candle building ───────────────────────────────────────────────── */

export function buildCandles(prices: number[], times: number[], interval = CANDLE_INTERVAL_S): Candle[] {
    if (prices.length < 2 || times.length < 2) return [];
    const candles: Candle[] = [];
    let current: Candle | null = null;
    for (let i = 0; i < prices.length; i++) {
        const t = times[i];
        if (!t) continue;
        const bucket = Math.floor(t / interval) * interval;
        if (!current || current.time !== bucket) {
            if (current) candles.push(current);
            current = { open: prices[i], high: prices[i], low: prices[i], close: prices[i], time: bucket };
        } else {
            current.high = Math.max(current.high, prices[i]);
            current.low = Math.min(current.low, prices[i]);
            current.close = prices[i];
        }
    }
    if (current) candles.push(current);
    return candles;
}

/* ── Band touch detection ───────────────────────────────────────────────────── */

/**
 * Returns which band the LATEST 1m candle is touching.
 * BB is computed from the last 20 candle closes (including the touching candle).
 */
export function getBandTouch(candles: Candle[]): BbTouch | null {
    if (candles.length < BB_PERIOD + 1) return null;
    const last = candles[candles.length - 1];
    const closes = candles.map(c => c.close);
    const bb = calcBollinger(closes, BB_PERIOD, BB_MULT);
    if (!bb) return null;
    if (last.high >= bb.upper) return { side: 'upper', bb, candle: last };
    if (last.low <= bb.lower) return { side: 'lower', bb, candle: last };
    return null;
}

/* ── Tick direction ─────────────────────────────────────────────────────────── */

export function tickDirection(prev: number, cur: number): 'up' | 'down' | 'flat' {
    if (cur > prev) return 'up';
    if (cur < prev) return 'down';
    return 'flat';
}

/* ── Pattern state machine ──────────────────────────────────────────────────── */

export function newPattern(): TickPattern {
    return { side: null, streak: 0, awaitingReversal: false, candleTime: 0 };
}

/**
 * Advance the per-symbol pattern on every tick.
 * Returns `fire: true` with the action to buy when the setup completes.
 */
export function stepPattern(
    pat: TickPattern,
    touch: BbTouch | null,
    dir: 'up' | 'down' | 'flat',
): { pat: TickPattern; fire: boolean; action: 'RUNHIGH' | 'RUNLOW' | null } {
    const touchTime = touch?.candle.time ?? 0;

    if (!pat.side || pat.candleTime !== touchTime) {
        pat = { side: touch?.side ?? null, streak: 0, awaitingReversal: false, candleTime: touchTime };
    }
    if (!pat.side || !touch) return { pat, fire: false, action: null };

    const desired = pat.side === 'upper' ? 'up' : 'down';

    if (dir === desired) {
        pat.streak++;
        if (pat.streak >= MIN_STREAK) pat.awaitingReversal = true;
        if (pat.streak > 15) {
            pat.streak = 0;
            pat.awaitingReversal = false;
        }
    } else if (dir === 'flat') {
        // Flat ticks neither advance nor reset the streak.
    } else {
        // Reversal tick.
        if (pat.awaitingReversal) {
            const action = pat.side === 'upper' ? 'RUNLOW' : 'RUNHIGH';
            pat = { side: null, streak: 0, awaitingReversal: false, candleTime: touchTime };
            return { pat, fire: true, action };
        }
        pat.streak = 0;
        pat.awaitingReversal = false;
    }

    return { pat, fire: false, action: null };
}

/* ── Trade execution ────────────────────────────────────────────────────────── */

export async function executeHighLowTrade(
    symbol: string, direction: 'RUNHIGH' | 'RUNLOW', stake: number, duration = TRADE_DURATION,
): Promise<{ contractId: string | null }> {
    const safeStake = Math.max(0.35, stake);
    const params = {
        amount: safeStake, basis: 'stake', currency: 'USD',
        duration, duration_unit: 't',
        symbol, contract_type: direction,
    };
    try {
        const response = await sendViaNewSystemWithPromise({ buy: 1, price: safeStake, parameters: params });
        if (response?.error) {
            console.warn('[HL] Trade error:', response.error);
            return { contractId: null };
        }
        const contractId = response?.buy?.contract_id ?? response?.contract_id;
        return { contractId: contractId ? String(contractId) : null };
    } catch (e: any) {
        console.warn('[HL] Trade exception:', e?.error || e?.message || e);
        return { contractId: null };
    }
}