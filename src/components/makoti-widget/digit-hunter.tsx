import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES, openMakotiWS, MakotiWS, getDigitPcts } from './makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';

interface LogEntry { time: string; msg: string; type: 'win' | 'loss' | 'info' | 'trade' | 'trigger' | 'recovery'; }
interface MarketData {
    symbol: string;
    ticks: number[];
    prices: number[];
    lastDigit: number | null;
    streakDigit: number | null;
    streakCount: number;
    pairHistory: Map<string, number>;
    digitPcts: number[];
}
interface ScoredMarket {
    symbol: string;
    freqScore: number;
    streakScore: number;
    pairScore: number;
    echoScore: number;
    totalScore: number;
    contractType: string;
    barrier: number;
    digit: number;
    reason: string;
    agreedDirection: string;
    agreementCount: number;
}

const LS_KEY = 'mw_dh_config';
const MAX_TICKS = 300;
const MIN_TICKS = 50;
const BASE_STAKE = 0.35;
const CONFIDENCE_THRESHOLD = 70;
const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_PAUSE_MS = 30000;
const MARTINGALE_FACTOR = 1.5;
const MIN_TRADE_INTERVAL_MS = 3000;

const DEFAULT_CFG = {
    stake: String(BASE_STAKE),
    confidenceThreshold: String(CONFIDENCE_THRESHOLD),
    recoveryEnabled: 'true',
    maxRecoveryAttempts: String(MAX_RECOVERY_ATTEMPTS),
    martingaleFactor: String(MARTINGALE_FACTOR),
};

function loadCfg() { try { const r = localStorage.getItem(LS_KEY); return r ? { ...DEFAULT_CFG, ...JSON.parse(r) } : DEFAULT_CFG; } catch { return DEFAULT_CFG; } }
function saveCfg(c: typeof DEFAULT_CFG) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {} }
function ts() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }

// ── Layer 5: Entry Digit Filter ──
// Only enter when current digit is in the "losing zone" (reversion to mean)
function isEntryFavorable(lastDigit: number, contractType: string, barrier: number): boolean {
    if (contractType === 'DIGITOVER') {
        // OVER X wins if digit > X. Enter when current digit is ≤ X (low digits due to revert)
        return lastDigit <= barrier;
    } else {
        // UNDER X wins if digit < X. Enter when current digit is ≥ X (high digits due to revert)
        return lastDigit >= barrier;
    }
}

// ── Rolling Window Weighted Percentages ──
function getWeightedPcts(ticks: number[], window: number = 30, recentWeight: number = 0.65): number[] {
    const counts = Array(10).fill(0);
    let totalCount = 0;
    const len = ticks.length;
    const recentLen = Math.min(window, len);
    const olderLen = len - recentLen;

    // Weight recent ticks
    for (let i = len - recentLen; i < len; i++) {
        counts[ticks[i]] += recentWeight;
        totalCount += recentWeight;
    }
    // Weight older ticks
    for (let i = 0; i < len - recentLen; i++) {
        counts[ticks[i]] += (1 - recentWeight);
        totalCount += (1 - recentWeight);
    }

    return counts.map(c => (c / totalCount) * 100);
}

// ── Layer 1: Digit Frequency Bias ──
function calcFreqScore(ticks: number[]): { score: number; digit: number; reason: string; skew: 'high' | 'low' | 'none'; skewScore: number; direction: 'over' | 'under' | 'none' } {
    if (ticks.length < MIN_TICKS) return { score: 0, digit: -1, reason: 'Not enough data', skew: 'none', skewScore: 0, direction: 'none' };
    const pcts = getWeightedPcts(ticks);
    let minPct = 100, minDigit = 0;
    pcts.forEach((p, d) => { if (p < minPct) { minPct = p; minDigit = d; } });
    const deviation = 10 - minPct;
    const score = Math.min(100, Math.max(0, deviation * 15 + 20));

    const lowPct = pcts[0] + pcts[1] + pcts[2] + pcts[3] + pcts[4];
    const highPct = pcts[5] + pcts[6] + pcts[7] + pcts[8] + pcts[9];
    let skew: 'high' | 'low' | 'none' = 'none';
    let skewScore = 0;
    let direction: 'over' | 'under' | 'none' = 'none';
    if (highPct > 55) { skew = 'high'; skewScore = Math.min(100, (highPct - 50) * 8 + 30); direction = 'under'; }
    else if (lowPct > 55) { skew = 'low'; skewScore = Math.min(100, (lowPct - 50) * 8 + 30); direction = 'over'; }

    return { score, digit: minDigit, reason: `D${minDigit} at ${minPct.toFixed(1)}% | Low:${lowPct.toFixed(0)}% High:${highPct.toFixed(0)}%`, skew, skewScore, direction };
}

// ── Layer 2: Streak Probability ──
function calcStreakScore(ticks: number[]): { score: number; digit: number; streakCount: number; reason: string; direction: 'over' | 'under' | 'none' } {
    if (ticks.length < 10) return { score: 0, digit: -1, streakCount: 0, reason: 'Not enough data', direction: 'none' };
    let streakDigit = ticks[ticks.length - 1];
    let streakCount = 1;
    for (let i = ticks.length - 2; i >= 0; i--) {
        if (ticks[i] === streakDigit) streakCount++;
        else break;
    }
    let score = 0;
    let direction: 'over' | 'under' | 'none' = 'none';
    if (streakCount === 2) score = 25;
    else if (streakCount === 3) score = 45;
    else if (streakCount >= 4) score = Math.min(100, 60 + (streakCount - 4) * 10);

    if (score > 0) {
        direction = streakDigit <= 4 ? 'over' : 'under';
    }
    return { score, digit: streakDigit, streakCount, reason: `D${streakDigit} streak: ${streakCount}x → DIFF ${streakDigit}`, direction };
}

// ── Layer 3: Pair Sequence Memory ──
function calcPairScore(ticks: number[]): { score: number; predictedDigit: number; reason: string; direction: 'over' | 'under' | 'none' } {
    if (ticks.length < 20) return { score: 0, predictedDigit: -1, reason: 'Not enough data', direction: 'none' };
    const lastDigit = ticks[ticks.length - 1];
    const followCounts = Array(10).fill(0);
    let total = 0;
    for (let i = 0; i < ticks.length - 1; i++) {
        if (ticks[i] === lastDigit) {
            followCounts[ticks[i + 1]]++;
            total++;
        }
    }
    if (total < 3) return { score: 0, predictedDigit: -1, reason: `D${lastDigit} pair data insufficient`, direction: 'none' };
    let maxCount = 0, predicted = 0;
    followCounts.forEach((c, d) => { if (c > maxCount) { maxCount = c; predicted = d; } });
    const ratio = maxCount / total;
    const score = Math.min(100, Math.max(0, (ratio - 0.1) * 250 + 20));

    let direction: 'over' | 'under' | 'none' = 'none';
    if (score > 0) {
        direction = predicted <= 4 ? 'over' : 'under';
    }
    return { score, predictedDigit: predicted, reason: `After D${lastDigit} → D${predicted} (${(ratio * 100).toFixed(0)}%)`, direction };
}

// ── Layer 4: Cross-Market Echo ──
function calcEchoScore(
    currentSymbol: string,
    currentDigit: number,
    allMarketData: Record<string, MarketData>,
): { score: number; echoDigit: number; reason: string; direction: 'over' | 'under' | 'none' } {
    let echoCount = 0;
    let totalChecks = 0;
    for (const [sym, md] of Object.entries(allMarketData)) {
        if (sym === currentSymbol) continue;
        if (md.ticks.length < 5) continue;
        const recent = md.ticks.slice(-5);
        totalChecks++;
        if (recent.includes(currentDigit)) echoCount++;
    }
    if (totalChecks < 3) return { score: 0, echoDigit: currentDigit, reason: 'Insufficient cross-market data', direction: 'none' };
    const echoRatio = echoCount / totalChecks;
    const score = Math.min(100, Math.max(0, echoRatio * 110 + 20));

    let direction: 'over' | 'under' | 'none' = 'none';
    if (score > 0) {
        direction = currentDigit <= 4 ? 'over' : 'under';
    }
    return { score, echoDigit: currentDigit, reason: `D${currentDigit} in ${echoCount}/${totalChecks} markets`, direction };
}

export const DigitHunter: React.FC = () => {
    const { transactions } = useStore();
    const cfg = loadCfg();
    const [stake, setStake] = useState(cfg.stake);
    const [confidenceThreshold, setConfidenceThreshold] = useState(cfg.confidenceThreshold);
    const [recoveryEnabled, setRecoveryEnabled] = useState(cfg.recoveryEnabled === 'true');
    const [maxRecoveryAttempts, setMaxRecoveryAttempts] = useState(cfg.maxRecoveryAttempts);
    const [martingaleFactor, setMartingaleFactor] = useState(cfg.martingaleFactor);
    const [running, setRunning] = useState(false);
    const [paused, setPaused] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [pnl, setPnl] = useState(0);
    const [trades, setTrades] = useState(0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [conn, setConn] = useState(false);
    const [bestMarket, setBestMarket] = useState('');
    const [bestScore, setBestScore] = useState(0);
    const [recoveryInfo, setRecoveryInfo] = useState({ phase: 'idle' as 'idle' | 'recovering' | 'paused', attempts: 0, currentStake: BASE_STAKE });

    const wsRef = useRef<MakotiWS | null>(null);
    const runRef = useRef(false);
    const pausedRef = useRef(false);
    const globalLock = useRef(false);
    const pnlRef = useRef(0);
    const cntRef = useRef(0);
    const winsRef = useRef(0);
    const lossesRef = useRef(0);
    const currentStakeRef = useRef(parseFloat(cfg.stake));
    const cfgRef = useRef({ stake: parseFloat(cfg.stake), threshold: parseFloat(cfg.confidenceThreshold), recovery: cfg.recoveryEnabled === 'true', maxRecovery: parseInt(cfg.maxRecoveryAttempts), martFactor: parseFloat(cfg.martingaleFactor) || MARTINGALE_FACTOR });
    const lastTradeTime = useRef(0);
    const contractMapRef = useRef<Map<string, { symbol: string; stake: number; contractType: string }>>(new Map());
    const allMarketDataRef = useRef<Record<string, MarketData>>({});
    const recoveryPhaseRef = useRef<'idle' | 'recovering' | 'paused'>('idle');
    const recoveryAttemptsRef = useRef(0);
    const recoveryPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastConsecutiveLossRef = useRef(0);

    // Config sync
    useEffect(() => { cfgRef.current = { stake: parseFloat(stake), threshold: parseFloat(confidenceThreshold), recovery: recoveryEnabled, maxRecovery: parseInt(maxRecoveryAttempts), martFactor: parseFloat(martingaleFactor) || MARTINGALE_FACTOR }; }, [stake, confidenceThreshold, recoveryEnabled, maxRecoveryAttempts, martingaleFactor]);
    useEffect(() => { saveCfg({ stake, confidenceThreshold, recoveryEnabled: String(recoveryEnabled), maxRecoveryAttempts, martingaleFactor }); }, [stake, confidenceThreshold, recoveryEnabled, maxRecoveryAttempts, martingaleFactor]);

    const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
        setLogs(prev => [...prev.slice(-99), { time: ts(), msg, type }]);
    }, []);

    const updatePnl = useCallback((delta: number) => {
        pnlRef.current += delta;
        setPnl(pnlRef.current);
    }, []);

    const updateWins = useCallback((isWin: boolean, profit: number) => {
        cntRef.current++;
        setTrades(cntRef.current);
        if (isWin) { winsRef.current++; setWins(winsRef.current); }
        else { lossesRef.current++; setLosses(lossesRef.current); }
        updatePnl(profit);
    }, [updatePnl]);

    // ── Initialize market data for all symbols ──
    useEffect(() => {
        ALL_SYMBOLS.forEach(sym => {
            if (!allMarketDataRef.current[sym]) {
                allMarketDataRef.current[sym] = {
                    symbol: sym, ticks: [], prices: [], lastDigit: null,
                    streakDigit: null, streakCount: 0,
                    pairHistory: new Map(), digitPcts: Array(10).fill(10),
                };
            }
        });
    }, []);

    // ── Score all markets ──
    const scoreAllMarkets = useCallback((): ScoredMarket | null => {
        const allData = allMarketDataRef.current;
        let best: ScoredMarket | null = null;

        for (const sym of ALL_SYMBOLS) {
            const md = allData[sym];
            if (!md || md.ticks.length < MIN_TICKS) continue;

            const lastDigit = md.ticks[md.ticks.length - 1];

            // Layer 1: Frequency
            const freq = calcFreqScore(md.ticks);

            // Layer 2: Streak
            const streak = calcStreakScore(md.ticks);

            // Layer 3: Pair
            const pair = calcPairScore(md.ticks);

            // Layer 4: Echo
            const echo = calcEchoScore(sym, lastDigit, allData);

            // Weighted total
            const totalScore = (freq.score * 0.30) + (streak.score * 0.25) + (pair.score * 0.25) + (echo.score * 0.20);

            // ── Layer 6: Direction Confirmation ──
            // Count how many layers agree on OVER vs UNDER
            const overVotes = [freq.direction, streak.direction, pair.direction, echo.direction].filter(d => d === 'over').length;
            const underVotes = [freq.direction, streak.direction, pair.direction, echo.direction].filter(d => d === 'under').length;
            const agreedDirection = overVotes >= underVotes ? 'over' : 'under';
            const agreementCount = Math.max(overVotes, underVotes);

            // Require at least 2 layers to agree on direction
            if (agreementCount < 2) continue;

            // ── Contract selection: OVER/UNDER with specific barriers ──
            // Primary: OVER 1, OVER 2, UNDER 8, UNDER 7
            // Recovery: OVER 3, OVER 4, UNDER 6, UNDER 5
            const pcts = getWeightedPcts(md.ticks);

            // Analyze digit groups for barrier selection
            const d01 = pcts[0] + pcts[1];                  // digits 0-1 (OVER 1 needs 2-9, 80% win)
            const d012 = pcts[0] + pcts[1] + pcts[2];      // digits 0-2 (OVER 2 needs 3-9, 70% win)
            const d0123 = pcts[0] + pcts[1] + pcts[2] + pcts[3]; // digits 0-3 (OVER 3 needs 4-9, 60% win)
            const d01234 = pcts[0] + pcts[1] + pcts[2] + pcts[3] + pcts[4]; // digits 0-4 (OVER 4 needs 5-9, 50% win)
            const d789 = pcts[7] + pcts[8] + pcts[9];      // digits 7-9 (UNDER 7 needs 0-6, 70% win)
            const d89 = pcts[8] + pcts[9];                  // digits 8-9 (UNDER 8 needs 0-7, 80% win)
            const d56789 = pcts[5] + pcts[6] + pcts[7] + pcts[8] + pcts[9]; // digits 5-9 (UNDER 5 needs 0-4, 50% win)
            const d6789 = pcts[6] + pcts[7] + pcts[8] + pcts[9]; // digits 6-9 (UNDER 6 needs 0-5, 60% win)

            // Expected: each 3-digit group ~30%, 4-digit ~40%, 5-digit ~50%
            let contractType: string;
            let barrier: number;
            let reason: string;

            const isRecovery = recoveryPhaseRef.current === 'recovering';

            if (isRecovery) {
                // ── RECOVERY MODE: medium-paying barriers (50-60% win, 1.6-2x payout) ──
                // OVER 3 wins if digit > 3, i.e. 4-9 (60%) — payout ~1.6x
                // OVER 4 wins if digit > 4, i.e. 5-9 (50%) — payout ~2x
                // UNDER 6 wins if digit < 6, i.e. 0-5 (60%) — payout ~1.6x
                // UNDER 5 wins if digit < 5, i.e. 0-4 (50%) — payout ~2x

                // Strong low-digit (0-4) overrepresentation → high digits due → OVER 4
                if (d01234 > 52) {
                    if (d01234 > 55) {
                        contractType = 'DIGITOVER';
                        barrier = 4;
                        reason = `🔄 RECOVERY: Low digits ${d01234.toFixed(0)}% (>55%) → OVER 4 (need 5-9, 2x)`;
                    } else {
                        contractType = 'DIGITOVER';
                        barrier = 3;
                        reason = `🔄 RECOVERY: Low digits ${d01234.toFixed(0)}% → OVER 3 (need 4-9, 1.6x)`;
                    }
                }
                // Strong high-digit (5-9) overrepresentation → low digits due → UNDER 5
                else if (d56789 > 52) {
                    if (d56789 > 55) {
                        contractType = 'DIGITUNDER';
                        barrier = 5;
                        reason = `🔄 RECOVERY: High digits ${d56789.toFixed(0)}% (>55%) → UNDER 5 (need 0-4, 2x)`;
                    } else {
                        contractType = 'DIGITUNDER';
                        barrier = 6;
                        reason = `🔄 RECOVERY: High digits ${d56789.toFixed(0)}% → UNDER 6 (need 0-5, 1.6x)`;
                    }
                } else {
                    // Balanced → default recovery UNDER 6 (60% win rate)
                    contractType = 'DIGITUNDER';
                    barrier = 6;
                    reason = `🔄 RECOVERY: Balanced → UNDER 6 (need 0-5, default)`;
                }
            } else {
                // ── PRIMARY MODE: wider barriers for higher win rate ──
                // OVER 1 wins if digit > 1, i.e. 2-9 (80% win rate)
                // OVER 2 wins if digit > 2, i.e. 3-9 (70% win rate)
                // UNDER 8 wins if digit < 8, i.e. 0-7 (80% win rate)
                // UNDER 7 wins if digit < 7, i.e. 0-6 (70% win rate)

                if (d01 > 22) {
                    // Digits 0,1 overrepresented (22%+ vs expected 20%) → OVER 1
                    contractType = 'DIGITOVER';
                    barrier = 1;
                    reason = `D0-1 at ${d01.toFixed(0)}% (>22%) → OVER 1 (need 2-9, 80%)`;
                } else if (d89 > 22) {
                    // Digits 8,9 overrepresented → UNDER 8
                    contractType = 'DIGITUNDER';
                    barrier = 8;
                    reason = `D8-9 at ${d89.toFixed(0)}% (>22%) → UNDER 8 (need 0-7, 80%)`;
                } else if (d012 > 32) {
                    // Digits 0,1,2 overrepresented (32%+ vs expected 30%) → OVER 2
                    contractType = 'DIGITOVER';
                    barrier = 2;
                    reason = `D0-2 at ${d012.toFixed(0)}% (>32%) → OVER 2 (need 3-9, 70%)`;
                } else if (d789 > 32) {
                    // Digits 7,8,9 overrepresented → UNDER 7
                    contractType = 'DIGITUNDER';
                    barrier = 7;
                    reason = `D7-9 at ${d789.toFixed(0)}% (>32%) → UNDER 7 (need 0-6, 70%)`;
                } else if (streak.streakCount >= 2) {
                    // Use streak direction with appropriate barrier
                    if (streak.digit <= 3) {
                        contractType = 'DIGITOVER';
                        barrier = 2;
                        reason = `D${streak.digit} streak ${streak.streakCount}x → OVER 2 (need 3-9)`;
                    } else {
                        contractType = 'DIGITUNDER';
                        barrier = 7;
                        reason = `D${streak.digit} streak ${streak.streakCount}x → UNDER 7 (need 0-6)`;
                    }
                } else {
                    // Default: OVER 1 (80% win rate, safest)
                    contractType = 'DIGITOVER';
                    barrier = 1;
                    reason = `No clear bias → OVER 1 (default, 80% win rate)`;
                }
            }

            const scored: ScoredMarket = {
                symbol: sym, freqScore: freq.score, streakScore: streak.score,
                pairScore: pair.score, echoScore: echo.score, totalScore,
                contractType, barrier, digit: barrier, reason,
                agreedDirection, agreementCount,
            };

            if (!best || totalScore > best.totalScore) best = scored;
        }
        return best;
    }, []);

    // ── Execute trade ──
    const executeTrade = useCallback(async (market: ScoredMarket, stakeAmt: number, isRecovery: boolean) => {
        if (globalLock.current) return;
        globalLock.current = true;

        const params = {
            amount: stakeAmt, basis: 'stake', currency: 'USD',
            duration: 1, duration_unit: 't',
            symbol: market.symbol,
            contract_type: market.contractType,
            barrier: String(market.barrier),
        };

        const label = market.contractType === 'DIGITOVER'
            ? `OVER ${market.barrier}`
            : `UNDER ${market.barrier}`;
        const prefix = isRecovery ? '🔄 RECOVERY' : '🎯';

        try {
            const response = await sendViaNewSystemWithPromise({ buy: 1, price: stakeAmt, parameters: params });
            const contractId = response?.buy?.contract_id ?? response?.contract_id;
            if (contractId) {
                contractMapRef.current.set(String(contractId), {
                    symbol: market.symbol, stake: stakeAmt, contractType: market.contractType,
                });
                lastTradeTime.current = Date.now();
                addLog(`${prefix} [${market.totalScore.toFixed(0)}%|${market.agreementCount}/4] ${SYMBOL_LABELS[market.symbol]}: ${label} @ $${stakeAmt.toFixed(2)} — ${market.reason}`, 'trade');
                try {
                    transactions.onBotContractEvent({
                        contract_id: contractId,
                        transaction_ids: { buy: response?.buy?.transaction_id },
                        buy_price: stakeAmt, currency: 'USD',
                        contract_type: market.contractType,
                        underlying: market.symbol,
                        display_name: SYMBOL_LABELS[market.symbol],
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch (_) {}
            } else {
                addLog(`Buy OK but no contract_id`, 'info');
                globalLock.current = false;
            }
        } catch (err: any) {
            addLog(`Buy error: ${err?.error?.message || err?.message || 'Unknown'}`, 'info');
            globalLock.current = false;
        }
    }, [addLog, transactions]);

    // ── Handle settlement ──
    const handleSettlement = useCallback((contractId: string, profit: number, isWin: boolean) => {
        const info = contractMapRef.current.get(contractId);
        if (!info) return;
        contractMapRef.current.delete(contractId);
        globalLock.current = false;

        updateWins(isWin, profit);

        if (isWin) {
            addLog(`✅ WIN +$${profit.toFixed(2)} on ${SYMBOL_LABELS[info.symbol]}`, 'win');
            // Reset recovery on win
            if (recoveryPhaseRef.current === 'recovering') {
                addLog('🟢 Recovery successful — resetting to base stake', 'recovery');
                recoveryPhaseRef.current = 'idle';
                recoveryAttemptsRef.current = 0;
                currentStakeRef.current = cfgRef.current.stake;
                setRecoveryInfo({ phase: 'idle', attempts: 0, currentStake: cfgRef.current.stake });
            }
            lastConsecutiveLossRef.current = 0;
        } else {
            addLog(`❌ LOSS -$${Math.abs(profit).toFixed(2)} on ${SYMBOL_LABELS[info.symbol]}`, 'loss');
            lastConsecutiveLossRef.current++;

            // Recovery logic
            if (cfgRef.current.recovery && recoveryPhaseRef.current !== 'paused') {
                recoveryAttemptsRef.current++;
                if (recoveryAttemptsRef.current > cfgRef.current.maxRecovery) {
                    // Max attempts reached → pause
                    addLog(`⏸ Max recovery attempts (${cfgRef.current.maxRecovery}) reached — pausing ${RECOVERY_PAUSE_MS / 1000}s`, 'recovery');
                    recoveryPhaseRef.current = 'paused';
                    setRecoveryInfo({ phase: 'paused', attempts: recoveryAttemptsRef.current, currentStake: currentStakeRef.current });
                    if (recoveryPauseTimerRef.current) clearTimeout(recoveryPauseTimerRef.current);
                    recoveryPauseTimerRef.current = setTimeout(() => {
                        addLog('▶ Resuming from pause — resetting to base stake', 'recovery');
                        recoveryPhaseRef.current = 'idle';
                        recoveryAttemptsRef.current = 0;
                        currentStakeRef.current = cfgRef.current.stake;
                        setRecoveryInfo({ phase: 'idle', attempts: 0, currentStake: cfgRef.current.stake });
                    }, RECOVERY_PAUSE_MS);
                } else {
                    // Increase stake for recovery
                    currentStakeRef.current = parseFloat((info.stake * cfgRef.current.martFactor).toFixed(2));
                    recoveryPhaseRef.current = 'recovering';
                    setRecoveryInfo({ phase: 'recovering', attempts: recoveryAttemptsRef.current, currentStake: currentStakeRef.current });
                    addLog(`🔄 Recovery attempt ${recoveryAttemptsRef.current}/${cfgRef.current.maxRecovery} — stake: $${currentStakeRef.current.toFixed(2)}`, 'recovery');
                }
            }
        }
    }, [addLog, updateWins]);

    // ── WS message handler ──
    const onMessage = useCallback((data: any) => {
        // History response (initial batch from subscribe) — populate instantly so scoring works
        if (data.msg_type === 'history') {
            const sym = data.echo_req?.ticks_history ?? data.req_id?.toString?.();
            const prices = data.history?.prices;
            if (!sym || !Array.isArray(prices) || !prices.length) return;
            const md = allMarketDataRef.current[sym];
            if (!md) return;
            if (md.ticks.length >= MIN_TICKS) return; // already populated
            const pipSize = PIP_SIZES[sym] ?? 4;
            md.ticks = [];
            md.prices = [];
            for (const priceStr of prices) {
                const price = Number(priceStr);
                if (isNaN(price)) continue;
                const lastDigit = parseInt(price.toFixed(pipSize).slice(-1), 10);
                md.ticks.push(lastDigit);
                md.prices.push(price);
            }
            if (md.ticks.length > MAX_TICKS) { md.ticks = md.ticks.slice(-MAX_TICKS); md.prices = md.prices.slice(-MAX_TICKS); }
            md.digitPcts = getWeightedPcts(md.ticks);
            md.lastDigit = md.ticks[md.ticks.length - 1];
            addLog(`📥 ${SYMBOL_LABELS[sym]} history loaded (${md.ticks.length} ticks)`);
            return;
        }

        // Tick data
        if (data.msg_type === 'tick') {
            const tick = data.tick;
            if (!tick) return;
            const sym = tick.symbol;
            const price = Number(tick.quote);
            if (isNaN(price)) return;
            const pipSize = PIP_SIZES[sym] ?? 4;
            const priceStr = price.toFixed(pipSize);
            const lastDigit = parseInt(priceStr.slice(-1), 10);

            const md = allMarketDataRef.current[sym];
            if (!md) return;
            md.ticks.push(lastDigit);
            md.prices.push(price);
            md.lastDigit = lastDigit;
            if (md.ticks.length > MAX_TICKS) { md.ticks.shift(); md.prices.shift(); }
            md.digitPcts = getWeightedPcts(md.ticks);

            // Run scoring and trading
            if (!runRef.current || pausedRef.current || globalLock.current) return;
            if (recoveryPauseTimerRef.current && recoveryPhaseRef.current === 'paused') return;

            const now = Date.now();
            if (now - lastTradeTime.current < MIN_TRADE_INTERVAL_MS) return;

            const best = scoreAllMarkets();
            if (!best) return;

            setBestMarket(best.symbol);
            setBestScore(best.totalScore);

            const threshold = cfgRef.current.threshold;
            const bestMd = allMarketDataRef.current[best.symbol];
            if (!bestMd || bestMd.ticks.length === 0) return;
            const entryDigit = bestMd.ticks[bestMd.ticks.length - 1];

            if (best.totalScore >= threshold) {
                // Layer 5: Entry Digit Filter — only enter when current digit is in favorable zone
                if (!isEntryFavorable(entryDigit, best.contractType, best.barrier)) return;

                const stakeAmt = recoveryPhaseRef.current === 'recovering' ? currentStakeRef.current : cfgRef.current.stake;
                executeTrade(best, stakeAmt, recoveryPhaseRef.current === 'recovering');
            }
        }

        // Contract settlement
        if (data.msg_type === 'proposal_open_contract') {
            const poc = data.proposal_open_contract;
            if (!poc || !poc.is_sold) return;
            const cid = String(poc.contract_id);
            if (!contractMapRef.current.has(cid)) return;
            const profit = Number(poc.profit) || 0;
            handleSettlement(cid, profit, profit > 0);
        }
    }, [scoreAllMarkets, executeTrade, handleSettlement]);

    // ── Connect WS ──
    useEffect(() => {
        const ws = openMakotiWS(
            onMessage,
            () => { setConn(true); addLog('Connected to Deriv API', 'info'); },
            () => { setConn(false); },
        );
        wsRef.current = ws;
        return () => ws.close();
    }, [onMessage, addLog]);

    // ── Subscribe to ticks ──
    useEffect(() => {
        if (!conn || !running) return;
        const ws = wsRef.current;
        if (!ws) return;
        ALL_SYMBOLS.forEach(sym => {
            ws.send({ ticks_history: sym, style: 'ticks', count: 100, end: 'latest', subscribe: 1 });
        });
    }, [conn, running]);

    // ── Start / Stop ──
    const handleStart = useCallback(() => {
        setRunning(true);
        runRef.current = true;
        pausedRef.current = false;
        setPaused(false);
        currentStakeRef.current = parseFloat(stake);
        recoveryPhaseRef.current = 'idle';
        recoveryAttemptsRef.current = 0;
        lastTradeTime.current = 0;
        addLog(`▶ Digit Hunter started — stake: $${stake}, threshold: ${confidenceThreshold}%`, 'info');
    }, [stake, confidenceThreshold, addLog]);

    const handleStop = useCallback(() => {
        setRunning(false);
        runRef.current = false;
        pausedRef.current = false;
        setPaused(false);
        recoveryPhaseRef.current = 'idle';
        recoveryAttemptsRef.current = 0;
        currentStakeRef.current = parseFloat(stake);
        if (recoveryPauseTimerRef.current) clearTimeout(recoveryPauseTimerRef.current);
        addLog('⏹ Digit Hunter stopped', 'info');
    }, [stake, addLog]);

    const handlePause = useCallback(() => {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
        addLog(pausedRef.current ? '⏸ Paused' : '▶ Resumed', 'info');
    }, [addLog]);

    // ── Cleanup ──
    useEffect(() => () => { if (recoveryPauseTimerRef.current) clearTimeout(recoveryPauseTimerRef.current); }, []);

    const logColor = (t: LogEntry['type']) => t === 'win' ? '#4caf50' : t === 'loss' ? '#f44336' : t === 'trade' ? '#2196f3' : t === 'recovery' ? '#ff9800' : t === 'trigger' ? '#9c27b0' : '#aaa';

    return (
        <div className='digit-hunter-theme' style={{ padding: 8, fontSize: 11, color: '#00ff41', fontFamily: 'Courier New, monospace' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#ffd700', fontWeight: 'bold', fontSize: 13 }}>🎯 DIGIT HUNTER</span>
                <span style={{ fontSize: 10, color: conn ? '#4caf50' : '#f44336' }}>{conn ? '● Connected' : '○ Disconnected'}</span>
            </div>

            {/* Config */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4, marginBottom: 6 }}>
                <label style={{ fontSize: 10, color: '#888' }}>Stake ($)
                    <input type="number" value={stake} onChange={e => setStake(e.target.value)}
                        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #333', color: '#fff', padding: 2, fontSize: 10, borderRadius: 3 }}
                        step="0.05" min="0.01" />
                </label>
                <label style={{ fontSize: 10, color: '#888' }}>Threshold (%)
                    <input type="number" value={confidenceThreshold} onChange={e => setConfidenceThreshold(e.target.value)}
                        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #333', color: '#fff', padding: 2, fontSize: 10, borderRadius: 3 }}
                        step="5" min="50" max="95" />
                </label>
                <label style={{ fontSize: 10, color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={recoveryEnabled} onChange={e => setRecoveryEnabled(e.target.checked)} />
                    Recovery (x{martingaleFactor})
                </label>
                <label style={{ fontSize: 10, color: '#888' }}>Martingale
                    <input type="number" value={martingaleFactor} onChange={e => setMartingaleFactor(e.target.value)}
                        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #333', color: '#fff', padding: 2, fontSize: 10, borderRadius: 3 }}
                        step="0.1" min="1" max="5" />
                </label>
                <label style={{ fontSize: 10, color: '#888' }} title="Consecutive losses that can be recovered before the bot pauses and resets the stake">Max Recovery
                    <input type="number" value={maxRecoveryAttempts} onChange={e => setMaxRecoveryAttempts(e.target.value)}
                        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #333', color: '#fff', padding: 2, fontSize: 10, borderRadius: 3 }}
                        step="1" min="1" max="10" />
                </label>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {!running ? (
                    <button onClick={handleStart} disabled={!conn}
                        style={{ flex: 1, padding: '4px 0', background: conn ? '#4caf50' : '#333', color: '#fff', border: 'none', borderRadius: 3, cursor: conn ? 'pointer' : 'not-allowed', fontSize: 11, fontWeight: 'bold' }}>
                        ▶ START
                    </button>
                ) : (
                    <>
                        <button onClick={handlePause}
                            style={{ flex: 1, padding: '4px 0', background: paused ? '#4caf50' : '#ff9800', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>
                            {paused ? '▶ RESUME' : '⏸ PAUSE'}
                        </button>
                        <button onClick={handleStop}
                            style={{ flex: 1, padding: '4px 0', background: '#f44336', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>
                            ⏹ STOP
                        </button>
                    </>
                )}
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, marginBottom: 6, textAlign: 'center' }}>
                <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                    <div style={{ fontSize: 9, color: '#888' }}>P&L</div>
                    <div style={{ fontSize: 12, color: pnl >= 0 ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>${pnl.toFixed(2)}</div>
                </div>
                <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                    <div style={{ fontSize: 9, color: '#888' }}>Trades</div>
                    <div style={{ fontSize: 12, color: '#fff' }}>{trades}</div>
                </div>
                <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                    <div style={{ fontSize: 9, color: '#888' }}>Wins</div>
                    <div style={{ fontSize: 12, color: '#4caf50' }}>{wins}</div>
                </div>
                <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                    <div style={{ fontSize: 9, color: '#888' }}>Losses</div>
                    <div style={{ fontSize: 12, color: '#f44336' }}>{losses}</div>
                </div>
            </div>

            {/* Best Market & Recovery */}
            {running && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, marginBottom: 6 }}>
                    <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                        <div style={{ fontSize: 9, color: '#888' }}>Best Market</div>
                        <div style={{ fontSize: 10, color: '#ffd700' }}>{bestMarket ? SYMBOL_LABELS[bestMarket] : 'Scanning...'}</div>
                        <div style={{ fontSize: 9, color: '#2196f3' }}>Score: {bestScore.toFixed(0)}%</div>
                    </div>
                    <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                        <div style={{ fontSize: 9, color: '#888' }}>Recovery</div>
                        <div style={{ fontSize: 10, color: recoveryInfo.phase === 'recovering' ? '#ff9800' : recoveryInfo.phase === 'paused' ? '#f44336' : '#4caf50' }}>
                            {recoveryInfo.phase === 'idle' ? 'Normal' : recoveryInfo.phase === 'recovering' ? `Attempt ${recoveryInfo.attempts}` : 'PAUSED'}
                        </div>
                        <div style={{ fontSize: 9, color: '#aaa' }}>Stake: ${recoveryInfo.currentStake.toFixed(2)}</div>
                    </div>
                </div>
            )}

            {/* Logs */}
            <div style={{ background: '#0d0d1a', borderRadius: 3, padding: 3, maxHeight: 150, overflowY: 'auto', border: '1px solid #222' }}>
                {logs.length === 0 && <div style={{ color: '#555', fontSize: 10 }}>No activity yet...</div>}
                {logs.map((l, i) => (
                    <div key={i} style={{ fontSize: 9, color: logColor(l.type), lineHeight: 1.4 }}>
                        <span style={{ color: '#555' }}>[{l.time}]</span> {l.msg}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DigitHunter;
