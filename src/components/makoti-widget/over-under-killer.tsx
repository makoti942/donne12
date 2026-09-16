import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES, openMakotiWS, MakotiWS } from './makoti-ws';
import { analyzeSignals, recordOutcome, TradeSignal, DigitAnalysis } from './prediction-engine';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import { MwSelect } from './mw-select';

/* ── Types ─────────────────────────────────────────────────────────────────── */
type ContractSide = 'DIGITOVER' | 'DIGITUNDER';

interface SymbolState {
    ticks: number[];
    prices: number[];
    digitFreq: number[];
    recentDigitFreq: number[];
    digitAnalysis: ReturnType<typeof analyzeDigitPsychology>;
    lastSignal: string;
    wins: number;
    losses: number;
    ready: boolean;
}

interface LogEntry {
    time: string;
    msg: string;
    type: 'win' | 'loss' | 'info' | 'trade';
}

/* ── Constants ─────────────────────────────────────────────────────────────── */
const MAX_TICKS              = 1000;
const MIN_TICKS_BEFORE_TRADE = 30;
const CONFIDENCE_THRESHOLD   = 80;
const AUTOMATE_CONFIDENCE    = 90;
const MAX_CONSECUTIVE_LOSSES = 5;
const SAFE_OVER_BARRIERS     = [1, 2, 3];
const SAFE_UNDER_BARRIERS    = [6, 7, 8];

const CONTRACT_SIDES: { label: string; value: ContractSide }[] = [
    { label: 'Over',  value: 'DIGITOVER' },
    { label: 'Under', value: 'DIGITUNDER' },
];

const LS_CONFIG_KEY  = 'mw_ouk_config';
const LS_LOGS_KEY = 'mw_ouk_logs';

const DEFAULT_CONFIG = { stake: '0.35', martingale: '2', takeProfit: '10', stopLoss: '5', predictionDigit: '5', contractSide: 'DIGITOVER' as const, recoveryMode: false, manualRecovery: false, recoverySide: 'DIGITOVER' as const, recoveryDigit: '5', recoveryLossThreshold: '1', manualRecoveryLossThreshold: '2', automate: false };

function loadConfig(): typeof DEFAULT_CONFIG {
    try {
        const raw = localStorage.getItem(LS_CONFIG_KEY);
        return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
    } catch {
        return DEFAULT_CONFIG;
    }
}
function saveConfig(cfg: typeof DEFAULT_CONFIG) {
    try { localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

/* ── Digit frequency analysis helpers ─────────────────────────────────────── */
function calcDigitPcts(ticks: number[]): number[] {
    const counts = new Array(10).fill(0);
    ticks.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    const total = counts.reduce((a, v) => a + v, 0);
    return total > 0 ? counts.map(c => (c / total) * 100) : counts;
}

function analyzeDigitPsychology(ticks: number[]): {
    freq: number[];
    recentFreq: number[];
    dominantDigit: number;
    rareDigit: number;
    streakLen: number;
    streakDigit: number;
    reversalSignal: boolean;
} {
    const full = ticks.slice(-200);
    const recent = ticks.slice(-30);
    const freq = calcDigitPcts(full);
    const recentFreq = calcDigitPcts(recent);

    let dominantDigit = 0, maxPct = 0;
    let rareDigit = 0, minPct = 100;
    freq.forEach((p, i) => {
        if (p > maxPct) { maxPct = p; dominantDigit = i; }
        if (p < minPct) { minPct = p; rareDigit = i; }
    });

    const lastDigit = ticks[ticks.length - 1];
    let streakLen = 0;
    for (let i = ticks.length - 1; i >= 0; i--) {
        if (ticks[i] === lastDigit) streakLen++;
        else break;
    }

    const reversalSignal = maxPct > 30 && (dominantDigit === lastDigit) && streakLen >= 3;

    return { freq, recentFreq, dominantDigit, rareDigit, streakLen, streakDigit: lastDigit, reversalSignal };
}

/* ── Recovery helpers ─────────────────────────────────────────────────────── */
const RECOVERY_STATS_WINDOW = 1000;
    const RECOVERY_LOSING_PCT_THRESHOLD = 9.8;

function calcLosingDigitPct(ticks: number[], barrier: number, side: ContractSide): number {
    const sample = ticks.slice(-RECOVERY_STATS_WINDOW);
    const pcts = calcDigitPcts(sample);
    if (side === 'DIGITOVER') {
        // OVER wins if exit digit > barrier. Losers are 0..barrier
        return pcts.slice(0, barrier + 1).reduce((a, v) => a + v, 0);
    } else {
        // UNDER wins if exit digit < barrier. Losers are barrier..9
        return pcts.slice(barrier).reduce((a, v) => a + v, 0);
    }
}

/**
 * Find the best volatility for recovery.
 * Priority: lowest losing digit % (target < 10%).
 * Uses last 1000 ticks (same as manual trade tab).
 */
function findBestRecoverySymbol(
    symbolData: Record<string, SymbolState>,
    barrier: number,
    side: ContractSide,
): { sym: string; losingPct: number } | null {
    let best: { sym: string; losingPct: number } | null = null;

    ALL_SYMBOLS.forEach(sym => {
        const sd = symbolData[sym];
        if (!sd || sd.ticks.length < MIN_TICKS_BEFORE_TRADE) return;
        const losingPct = calcLosingDigitPct(sd.ticks, barrier, side);
        if (!best || losingPct < best.losingPct) {
            best = { sym, losingPct };
        }
    });

    return best;
}

/**
 * Validate recovery entry conditions:
 * 1. At least 2 of the losing digits appeared in the last 15 ticks
 * 2. Losing digits should be dominant (appearing frequently in recent ticks)
 * 3. Winning digits should be the majority
 */
function validateRecoveryEntry(
    ticks: number[],
    barrier: number,
    side: ContractSide,
): { valid: boolean; reason: string } {
    const last15 = ticks.slice(-15);
    const last100 = ticks.slice(-100);

    if (side === 'DIGITOVER') {
        // Losing digits: 0..barrier
        const losingDigits = Array.from({ length: barrier + 1 }, (_, i) => i);
        // Winning digits: barrier+1..9
        const winningDigits = Array.from({ length: 9 - barrier }, (_, i) => i + barrier + 1);

        // Rule 1: At least 2 losing digits appeared in last 15 ticks
        const losingInLast15 = losingDigits.filter(d => last15.includes(d));
        if (losingInLast15.length < 2) {
            return { valid: false, reason: `Only ${losingInLast15.length} losing digit(s) in last 15 ticks (need 2+)` };
        }

        // Rule 2: Losing digits should be dominant in recent ticks
        const recentPcts = calcDigitPcts(last100);
        const losingTotal = losingDigits.reduce((a, d) => a + recentPcts[d], 0);
        const winningTotal = winningDigits.reduce((a, d) => a + recentPcts[d], 0);

        // Rule 3: Winning digits should be majority
        if (winningTotal <= losingTotal) {
            return { valid: false, reason: `Winning digits ${winningTotal.toFixed(0)}% not dominant over losing ${losingTotal.toFixed(0)}%` };
        }

        return { valid: true, reason: `Losing ${losingTotal.toFixed(0)}% | Winning ${winningTotal.toFixed(0)}% | ${losingInLast15.length} losing digits in last 15` };
    } else {
        // UNDER: Losing digits: barrier..9
        const losingDigits = Array.from({ length: 10 - barrier }, (_, i) => i + barrier);
        // Winning digits: 0..barrier-1
        const winningDigits = Array.from({ length: barrier }, (_, i) => i);

        // Rule 1: At least 2 losing digits appeared in last 15 ticks
        const losingInLast15 = losingDigits.filter(d => last15.includes(d));
        if (losingInLast15.length < 2) {
            return { valid: false, reason: `Only ${losingInLast15.length} losing digit(s) in last 15 ticks (need 2+)` };
        }

        // Rule 2: Losing digits should be dominant in recent ticks
        const recentPcts = calcDigitPcts(last100);
        const losingTotal = losingDigits.reduce((a, d) => a + recentPcts[d], 0);
        const winningTotal = winningDigits.reduce((a, d) => a + recentPcts[d], 0);

        // Rule 3: Winning digits should be majority
        if (winningTotal <= losingTotal) {
            return { valid: false, reason: `Winning digits ${winningTotal.toFixed(0)}% not dominant over losing ${losingTotal.toFixed(0)}%` };
        }

        return { valid: true, reason: `Losing ${losingTotal.toFixed(0)}% | Winning ${winningTotal.toFixed(0)}% | ${losingInLast15.length} losing digits in last 15` };
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   OverUnderKiller
════════════════════════════════════════════════════════════════════════════ */
export const OverUnderKiller: React.FC = () => {
    const { transactions } = useStore();

    const initCfg = loadConfig();
    const [stake,       setStake]       = useState(initCfg.stake);
    const [martingale,  setMartingale]  = useState(initCfg.martingale);
    const [takeProfit,  setTakeProfit]  = useState(initCfg.takeProfit);
    const [stopLoss,    setStopLoss]    = useState(initCfg.stopLoss);
    const [predictionDigit, setPredictionDigit] = useState(initCfg.predictionDigit);
    const [contractSide, setContractSide] = useState<ContractSide>(initCfg.contractSide);
    const [recoveryMode, setRecoveryMode] = useState(initCfg.recoveryMode);
    const [manualRecovery, setManualRecovery] = useState(initCfg.manualRecovery);
    const [recoverySide, setRecoverySide] = useState<ContractSide>(initCfg.recoverySide);
    const [recoveryDigit, setRecoveryDigit] = useState(initCfg.recoveryDigit);
    const [recoveryLossThreshold, setRecoveryLossThreshold] = useState(initCfg.recoveryLossThreshold);
    const [manualRecoveryLossThreshold, setManualRecoveryLossThreshold] = useState(initCfg.manualRecoveryLossThreshold);
    const [automate,    setAutomate]    = useState(initCfg.automate);
    const [running,     setRunning]     = useState(false);
    const [pnl,         setPnl]         = useState(0);
    const [logs,        setLogs]        = useState<LogEntry[]>([]);
    const [activeContracts, setActiveContracts] = useState(0);
    const [digitAnalysis, setDigitAnalysis] = useState<ReturnType<typeof analyzeDigitPsychology> | null>(null);
    const [signalDisplay, setSignalDisplay] = useState<{
        confidence: number; side: string; barrier: string; strategies: string;
    } | null>(null);
    const [symbolDisplay, setSymbolDisplay] = useState<Record<string, { lastSignal: string; wins: number; losses: number; stake: number }>>({});

    /* ── Refs ─────────────────────────────────────────────────────────────── */
    const wsRef                 = useRef<MakotiWS | null>(null);
    const symbolDataRef         = useRef<Record<string, SymbolState>>({});
    const pnlRef                = useRef(0);
    const runningRef            = useRef(false);
    const stakeParsed           = useRef(0.35);
    const martingaleParsed      = useRef(2);
    const tpRef                 = useRef(10);
    const slRef                 = useRef(5);
    const predictionDigitRef    = useRef(5);
    const contractSideRef       = useRef<ContractSide>('DIGITOVER');
    const recoveryRef           = useRef(false);
    const manualRecoveryRef     = useRef(false);
    const recoverySideRef       = useRef<ContractSide>('DIGITOVER');
    const recoveryDigitRef      = useRef(5);
    const recoveryLossThresholdRef = useRef(1);
    const manualRecoveryLossThresholdRef = useRef(2);
    const inManualRecoveryRef   = useRef(false);
    const recoverySymRef        = useRef('');           // chosen symbol for recovery
    const automateRef           = useRef(false);

    const globalLock            = useRef(false);
    const activeContractsRef    = useRef(0);
    const globalStakeRef        = useRef(0.35);
    const contractMapRef        = useRef<Map<string, { symbol: string; stake: number; strategyNames: string[]; duration: number; barrier: string }>>(new Map());
    const consecutiveLossesRef  = useRef(0);
    const cooldownTicksRef      = useRef(0);
    const signalHistoryRef      = useRef<{ sym: string; type: string; conf: number }[]>([]);
    const lastTickSymRef        = useRef('');
    const pausedRef             = useRef(false);
    const barrierHistoryRef     = useRef<Map<string, { wins: number; losses: number }>>(new Map());

    /* ── Persist ──────────────────────────────────────────────────────────── */
    useEffect(() => { saveConfig({ stake, martingale, takeProfit, stopLoss, predictionDigit, contractSide, recoveryMode, manualRecovery, recoverySide, recoveryDigit, recoveryLossThreshold, manualRecoveryLossThreshold, automate }); }, [stake, martingale, takeProfit, stopLoss, predictionDigit, contractSide, recoveryMode, manualRecovery, recoverySide, recoveryDigit, recoveryLossThreshold, manualRecoveryLossThreshold, automate]);

    /* ── Log helper (defined FIRST — no deps) ────────────────────────────── */
    const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 120));
    }, []);

    const clearLogs = useCallback(() => {
        setLogs([]);
        localStorage.removeItem(LS_LOGS_KEY);
    }, []);

    /* ── stopKiller (dep: addLog) ───────────────────────────────────────── */
    const stopKiller = useCallback(() => {
        runningRef.current = false;
        globalLock.current = false;
        lastTickSymRef.current = '';
        inManualRecoveryRef.current = false;
        recoverySymRef.current = '';
        setRunning(false);
        try { wsRef.current?.close(); } catch (_) {}
        wsRef.current = null;
        activeContractsRef.current = 0;
        setActiveContracts(0);
        addLog('Over/Under Killer stopped.', 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addLog]);

    /* ── flushDisplay (no deps) ─────────────────────────────────────────── */
    const flushDisplay = useCallback((sym: string) => {
        const sd = symbolDataRef.current[sym];
        if (!sd) return;
        setSymbolDisplay(prev => ({
            ...prev,
            [sym]: {
                lastSignal: sd.lastSignal,
                wins: sd.wins,
                losses: sd.losses,
                stake: globalStakeRef.current,
            },
        }));
    }, []);

    /* ── checkLimits (dep: addLog, stopKiller from closure) ─────────────── */
    const checkLimits = useCallback(() => {
        if (pnlRef.current >= tpRef.current) {
            addLog(`✅ Take Profit +$${tpRef.current} reached! P&L: $${pnlRef.current.toFixed(2)}`, 'win');
            stopKiller();
            return true;
        }
        if (pnlRef.current <= -slRef.current) {
            addLog(`🛑 Stop Loss -$${slRef.current} hit! P&L: $${pnlRef.current.toFixed(2)}`, 'loss');
            stopKiller();
            return true;
        }
        return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addLog]);

    /* ── handleRecovery (dep: addLog, stopKiller from closure) ──────────── */
    const handleRecovery = useCallback((sym: string, lossAmount: number) => {
        addLog(`🔄 RECOVERY MODE ACTIVATED — switching to Rise/Fall via Market Killer to recover $${lossAmount.toFixed(2)}`, 'info');
        stopKiller();
        window.DBot = window.DBot || {};
        window.DBot.__recovery = {
            active: true,
            pending: lossAmount,
            stake: stakeParsed.current,
            martingale: martingaleParsed.current,
            vhThreshold: recoveryLossThresholdRef.current,
        };
        window.DBot.__ou_config = {
            stake: stakeParsed.current,
            martingale: martingaleParsed.current,
            takeProfit: tpRef.current,
            stopLoss: slRef.current,
            predictionDigit: predictionDigitRef.current,
            contractSide: contractSideRef.current,
            recoveryMode: recoveryRef.current,
            manualRecovery: manualRecoveryRef.current,
            recoverySide: recoverySideRef.current,
            recoveryDigit: recoveryDigitRef.current,
            recoveryLossThreshold: recoveryLossThresholdRef.current,
        };
        window.DBot.__recovery_auto_start = true;
        if (typeof window.DBot.__switchToTab === 'function') {
            window.DBot.__switchToTab('market_killer');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addLog]);

    /* ── POC listener (uses addLog, stopKiller, flushDisplay, checkLimits, handleRecovery) ── */
    const pocUnsubRef = useRef<(() => void) | null>(null);
    const subscribePOC = useCallback(() => {
        if (!window._newSystemWS) return;
        window._newSystemWS.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));
    }, []);

    useEffect(() => {
        if (!running) return;
        subscribePOC();
        if (pocUnsubRef.current) pocUnsubRef.current();

        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'proposal_open_contract') return;
                const c = data.proposal_open_contract;
                if (!c?.is_sold) return;
                const cid = String(c.contract_id);
                const entry = contractMapRef.current.get(cid);
                if (!entry) return;
                contractMapRef.current.delete(cid);

                const { symbol: sym, stake: tradeStake, strategyNames, duration, barrier } = entry;
                const sd = symbolDataRef.current[sym];
                if (!sd) return;

                const profit = Number(c.profit);
                const won = profit >= 0;

                // Track barrier win rate
                const barrierKey = `${sym}_${barrier}`;
                if (!barrierHistoryRef.current.has(barrierKey)) barrierHistoryRef.current.set(barrierKey, { wins: 0, losses: 0 });
                const bh = barrierHistoryRef.current.get(barrierKey)!;
                if (won) bh.wins++; else bh.losses++;
                // Keep only last 20 trades per barrier
                if (bh.wins + bh.losses > 20) {
                    const ratio = bh.wins / (bh.wins + bh.losses);
                    bh.wins = Math.round(ratio * 10);
                    bh.losses = 10 - bh.wins;
                }

                strategyNames.forEach(n => recordOutcome(n, won));

                pnlRef.current += profit;
                setPnl(pnlRef.current);

                if (won) {
                    sd.wins++;
                    const wasInRecovery = inManualRecoveryRef.current;
                    if (wasInRecovery) {
                        inManualRecoveryRef.current = false;
                        recoverySymRef.current = '';
                        addLog(`✅ MANUAL RECOVERY WON — back to normal`, 'win');
                    }
                    consecutiveLossesRef.current = 0;
                    cooldownTicksRef.current = 0;
                    pausedRef.current = false;
                    globalStakeRef.current = stakeParsed.current;
                    addLog(`✅ WON +$${profit.toFixed(2)} on ${SYMBOL_LABELS[sym]} | Next stake reset to $${stakeParsed.current.toFixed(2)} | P&L $${pnlRef.current.toFixed(2)}`, 'win');
                } else {
                    sd.losses++;
                    consecutiveLossesRef.current++;
                    globalStakeRef.current = Number((tradeStake * martingaleParsed.current).toFixed(2));
                    addLog(`❌ LOST -$${Math.abs(profit).toFixed(2)} on ${SYMBOL_LABELS[sym]} | Next stake $${globalStakeRef.current.toFixed(2)} | P&L $${pnlRef.current.toFixed(2)}`, 'loss');

                        if (recoveryRef.current) {
                            handleRecovery(sym, Math.abs(profit));
                            return;
                        }
if (manualRecoveryRef.current && consecutiveLossesRef.current >= manualRecoveryLossThresholdRef.current && !inManualRecoveryRef.current) {
                            inManualRecoveryRef.current = true;
                            signalHistoryRef.current = [];
                            addLog(`🔄 MANUAL RECOVERY — reversal entry | ${recoverySideRef.current === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${recoveryDigitRef.current} | Losing threshold: ${RECOVERY_LOSING_PCT_THRESHOLD}% | Entry: wait for losing digit to appear`, 'info');
                        }
                    }

                flushDisplay(sym);
                globalLock.current = false;
                activeContractsRef.current = 0;
                setActiveContracts(0);
                checkLimits();
            } catch (_) {}
        });

        pocUnsubRef.current = unsub;
        return () => { unsub(); pocUnsubRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running]);

    /* ── executeTrade (dep: addLog, flushDisplay) ────────────────────────── */
    const executeTrade = useCallback(async (sym: string, signal: TradeSignal) => {
        if (!runningRef.current) return;
        const threshold = inManualRecoveryRef.current
            ? CONFIDENCE_THRESHOLD + 5
            : CONFIDENCE_THRESHOLD;
        if (!signal || signal.confidence < threshold) return;

        const sd = symbolDataRef.current[sym];
        if (!sd) return;

        globalLock.current = true;
        activeContractsRef.current = 1;
        setActiveContracts(1);

        const { contract_type, reason, confidence, details, barrier: signalBarrier } = signal;
        const tradeStake = Number(globalStakeRef.current.toFixed(2));
        const duration = 1;

        if (!automateRef.current) {
            const userSide = inManualRecoveryRef.current ? recoverySideRef.current : contractSideRef.current;
            if (contract_type !== userSide) {
                addLog(`⏳ Signal is ${contract_type === 'DIGITOVER' ? 'OVER' : 'UNDER'} but need ${userSide === 'DIGITOVER' ? 'OVER' : 'UNDER'} — waiting for alignment`, 'info');
                globalLock.current = false;
                activeContractsRef.current = 0;
                setActiveContracts(0);
                return;
            }
        }

        addLog(`Trade stake: $${tradeStake.toFixed(2)} (base: $${stakeParsed.current.toFixed(2)}, mg: ${martingaleParsed.current}x)`, 'trade');

        const strategyMatch = details.match(/Strategies: (.+)/);
        const strategyNames = strategyMatch
            ? strategyMatch[1].split(',').map(s => s.trim().split('(')[0])
            : ['ensemble'];

        const actualBarrier = automateRef.current ? (signalBarrier || '5') : (inManualRecoveryRef.current ? recoveryDigitRef.current : predictionDigitRef.current);
        const contractTypeStr = contract_type === 'DIGITOVER' ? 'DIGITOVER' : 'DIGITUNDER';

        const params: any = {
            amount: tradeStake, basis: 'stake', currency: 'USD',
            duration, duration_unit: 't',
            symbol: sym, contract_type: contractTypeStr,
            barrier: String(actualBarrier),
        };

        const label = contract_type === 'DIGITOVER' ? `OVER ${actualBarrier}` : `UNDER ${actualBarrier}`;

        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            try {
                const response = await sendViaNewSystemWithPromise({ buy: 1, price: tradeStake, parameters: params });
                const contractId = response?.buy?.contract_id ?? response?.contract_id;
                if (contractId) {
                    contractMapRef.current.set(String(contractId), { symbol: sym, stake: tradeStake, strategyNames, duration, barrier: String(actualBarrier) });
                    sd.lastSignal = label;
                    addLog(`🎯 [${confidence.toFixed(0)}%] ${SYMBOL_LABELS[sym]}: ${label} D${duration} @ $${tradeStake} — ${reason}`, 'trade');
                    addLog(`Contract ${contractId} open on ${SYMBOL_LABELS[sym]}`, 'info');
                    flushDisplay(sym);
                    try {
                        transactions.onBotContractEvent({
                            contract_id: contractId,
                            transaction_ids: { buy: response?.buy?.transaction_id },
                            buy_price: tradeStake,
                            currency: 'USD',
                            contract_type: contractTypeStr,
                            underlying: sym,
                            display_name: SYMBOL_LABELS[sym],
                            date_start: Math.floor(Date.now() / 1000),
                            status: 'open',
                        } as any);
                    } catch (_) {}
                } else {
                    addLog(`Buy ok but no contract_id: ${JSON.stringify(response).slice(0, 100)}`, 'info');
                    globalLock.current = false;
                    activeContractsRef.current = 0;
                    setActiveContracts(0);
                }
            } catch (err: any) {
                addLog(`Buy error: ${err?.error?.message || err?.message || 'Unknown'}`, 'info');
                globalLock.current = false;
                activeContractsRef.current = 0;
                setActiveContracts(0);
            }
        } else if (wsRef.current?.isOpen()) {
            wsRef.current.send({ buy: 1, price: tradeStake, parameters: params });
            sd.lastSignal = label;
            addLog(`🎯 [${confidence.toFixed(0)}%] ${SYMBOL_LABELS[sym]}: ${label} D${duration} @ $${tradeStake} — ${reason}`, 'trade');
            contractMapRef.current.set(sym + Date.now(), { symbol: sym, stake: tradeStake, strategyNames, duration, barrier: String(actualBarrier) });
            flushDisplay(sym);
            try {
                transactions.onBotContractEvent({
                    transaction_ids: { buy: sym + Date.now() },
                    contract_id: sym + Date.now(),
                    buy_price: tradeStake,
                    currency: 'USD',
                    contract_type: contractTypeStr,
                    underlying: sym,
                    display_name: SYMBOL_LABELS[sym],
                    date_start: Math.floor(Date.now() / 1000),
                    entry_tick_time: Math.floor(Date.now() / 1000),
                    status: 'open',
                } as any);
            } catch (_) {}
        } else {
            globalLock.current = false;
            activeContractsRef.current = 0;
            setActiveContracts(0);
        }
    }, [addLog, flushDisplay]);

    /* ── onTickReceived (dep: executeTrade) ─────────────────────────────── */
    const onTickReceived = useCallback(() => {
        if (!runningRef.current) return;
        if (pausedRef.current) return;
        if (globalLock.current) return;

        // ── RECOVERY MODE: reversal entry on all symbols ──
        if (inManualRecoveryRef.current) {
            const recBarrier = recoveryDigitRef.current;
            const recSide = recoverySideRef.current;

            // Define losing digits for this barrier/side
            const losingDigits = recSide === 'DIGITOVER'
                ? Array.from({ length: recBarrier + 1 }, (_, i) => i)     // 0..barrier
                : Array.from({ length: 10 - recBarrier }, (_, i) => i + recBarrier); // barrier..9

            for (const sym of ALL_SYMBOLS) {
                const sd = symbolDataRef.current[sym];
                if (!sd || sd.ticks.length < MIN_TICKS_BEFORE_TRADE) continue;

                // Each losing digit must be below 9.8% individually
                const digitFreq = calcDigitPcts(sd.ticks);
                const belowCount = losingDigits.filter(d => digitFreq[d] < RECOVERY_LOSING_PCT_THRESHOLD).length;
                const majorityCount = Math.floor(losingDigits.length / 2) + 1;

                // Pass 1: ALL losing digits below threshold
                // Pass 2 (fallback): MOST losing digits below threshold
                if (belowCount < losingDigits.length && belowCount < majorityCount) continue;

                // Execute like normal trade on this symbol
                const sig = analyzeSignals(sd.ticks, sd.prices, [recSide], sd.digitFreq, sd.digitAnalysis);
                if (!sig || sig.confidence < 70) continue;

                // 2-tick confirmation
                signalHistoryRef.current.push({ sym, type: recSide, conf: sig.confidence });
                if (signalHistoryRef.current.length > 2) signalHistoryRef.current.shift();
                const last2 = signalHistoryRef.current;
                const confirmed = last2.length === 2 && last2.every(s => s.sym === sym && s.type === recSide);
                if (!confirmed) continue;

                // Confirmed — execute
                signalHistoryRef.current = [];
                const isPerfect = belowCount === losingDigits.length;
                const recoverySig: TradeSignal = {
                    ...sig,
                    contract_type: recSide,
                    barrier: String(recBarrier),
                    confidence: sig.confidence,
                    reason: `${belowCount}/${losingDigits.length} losing digits <${RECOVERY_LOSING_PCT_THRESHOLD}%${isPerfect ? ' (all clear)' : ' (fallback)'}`,
                    details: sig.details,
                };

                setDigitAnalysis(analyzeDigitPsychology(sd.ticks));
                setSignalDisplay({ confidence: sig.confidence, side: recSide, barrier: String(recBarrier), strategies: isPerfect ? 'Recovery (all clear)' : 'Recovery (fallback)' });
                addLog(`🎯 RECOVERY: ${SYMBOL_LABELS[sym]} | ${recSide === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${recBarrier} | ${belowCount}/${losingDigits.length} losing digits <${RECOVERY_LOSING_PCT_THRESHOLD}%${isPerfect ? ' ✅' : ' ⚠️'} | 2-tick confirmed`, 'trade');
                executeTrade(sym, recoverySig).catch(() => {});
                return; // One trade at a time
            }
            return;
        }

        // ── NORMAL MODE: scan all symbols for best signal ──
        let bestSym  = '';
        let bestSig: TradeSignal | null = null;
        let bestConf = CONFIDENCE_THRESHOLD - 1;

        ALL_SYMBOLS.forEach(s => {
            const sd = symbolDataRef.current[s];
            if (!sd || sd.ticks.length < MIN_TICKS_BEFORE_TRADE) return;
            const sig = analyzeSignals(sd.ticks, sd.prices, ['DIGITOVER', 'DIGITUNDER'], sd.digitFreq, sd.digitAnalysis);
            if (sig && sig.confidence > bestConf) {
                bestConf = sig.confidence;
                bestSym  = s;
                bestSig  = sig;
            }
        });

        if (bestSym && symbolDataRef.current[bestSym]) {
            const sd = symbolDataRef.current[bestSym];
            const analysis = analyzeDigitPsychology(sd.ticks);
            setDigitAnalysis(analysis);
        }

        if (bestSig) {
            setSignalDisplay({
                confidence: bestSig.confidence,
                side: bestSig.contract_type,
                barrier: bestSig.barrier || String(predictionDigitRef.current),
                strategies: bestSig.details,
            });
        }

        if (bestSym && bestSig) {
            signalHistoryRef.current.push({ sym: bestSym, type: bestSig.contract_type, conf: bestSig.confidence });
            if (signalHistoryRef.current.length > 2) signalHistoryRef.current.shift();
            const last2 = signalHistoryRef.current;
            const confirmed = last2.length === 2 && last2.every(s => s.sym === bestSym && s.type === bestSig.contract_type);
            if (confirmed) {
                signalHistoryRef.current = [];
                executeTrade(bestSym, bestSig).catch(() => {});
            }
        }
    }, [executeTrade]);

    const onTickRef = useRef(onTickReceived);
    onTickRef.current = onTickReceived;

    /* ── Start ───────────────────────────────────────────────────────────── */
    const startKiller = useCallback(() => {
        const stakeVal = Math.max(0.35, parseFloat(stake) || 0.35);
        const mgVal    = Math.max(1,    parseFloat(martingale) || 2);
        const tpVal    = Math.max(0.5,  parseFloat(takeProfit) || 10);
        const slVal    = Math.max(0.5,  parseFloat(stopLoss)   || 5);
        const predVal  = Math.min(9, Math.max(0, parseInt(predictionDigit) || 5));

        stakeParsed.current      = stakeVal;
        martingaleParsed.current = mgVal;
        tpRef.current            = tpVal;
        slRef.current            = slVal;
        predictionDigitRef.current = predVal;
        contractSideRef.current  = contractSide;
        recoveryRef.current      = recoveryMode;
        manualRecoveryRef.current = manualRecovery;
        recoverySideRef.current   = recoverySide;
        recoveryDigitRef.current  = Math.min(9, Math.max(0, parseInt(recoveryDigit) || 5));
        const parsedRlt = parseInt(recoveryLossThreshold);
        recoveryLossThresholdRef.current = isNaN(parsedRlt) ? 1 : Math.max(0, parsedRlt);
        const parsedMrlt = parseInt(manualRecoveryLossThreshold);
        manualRecoveryLossThresholdRef.current = isNaN(parsedMrlt) ? 2 : Math.max(1, parsedMrlt);
        automateRef.current = automate;
        inManualRecoveryRef.current = false;
        recoverySymRef.current = '';
        pausedRef.current = false;
        globalLock.current       = false;
        lastTickSymRef.current   = '';
        activeContractsRef.current = 0;
        globalStakeRef.current   = stakeVal;
        consecutiveLossesRef.current = 0;
        cooldownTicksRef.current = 0;

        setActiveContracts(0);
        setSymbolDisplay({});
        setSignalDisplay(null);
        setDigitAnalysis(null);
        contractMapRef.current = new Map();

        // Don't reset symbol data if already populated from auto-subscription
        const hasData = Object.values(symbolDataRef.current).some(sd => sd.ticks.length > 0);
        if (!hasData) {
            symbolDataRef.current = {};
            ALL_SYMBOLS.forEach(sym => {
                symbolDataRef.current[sym] = {
                    ticks: [], prices: [], digitFreq: new Array(10).fill(0), recentDigitFreq: new Array(10).fill(0),
                    digitAnalysis: analyzeDigitPsychology([]),
                    lastSignal: '—', wins: 0, losses: 0, ready: false,
                };
            });
        }

        runningRef.current = true;
        setRunning(true);

        const modeDesc = automate ? 'Auto (OU) — any signal/barrier' : `${contractSide === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${predVal}`;
        addLog(`⚔ Over/Under Killer — ${modeDesc} | stake $${stakeVal}  MG ×${mgVal}  TP $${tpVal}  SL $${slVal}`, 'info');
        if (recoveryMode) {
            addLog(`🔄 RECOVERY MODE ON — real losses switch to Rise/Fall via Market Killer`, 'info');
        }
        if (manualRecovery) {
            addLog(`🔄 MANUAL RECOVERY ON — ${manualRecoveryLossThreshold} loss${manualRecoveryLossThreshold !== '1' ? 'es' : ''} → switch to ${recoverySide === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${recoveryDigitRef.current}`, 'info');
        }
        addLog('Connected — using live tick stream', 'info');

        if (wsRef.current) { try { wsRef.current.close(); } catch (_) {} wsRef.current = null; }

        const handleMsg = (data: any) => {
            if (!runningRef.current) return;

            if (data.error) {
                if (data.msg_type === 'buy') {
                    addLog(`Buy error: ${data.error.message}`, 'info');
                    globalLock.current = false;
                    activeContractsRef.current = 0;
                    setActiveContracts(0);
                }
                return;
            }

            switch (data.msg_type) {
                case 'history': {
                    const sym: string = data.echo_req?.ticks_history;
                    if (!sym || !symbolDataRef.current[sym]) return;
                    const sd  = symbolDataRef.current[sym];
                    const pip = PIP_SIZES[sym] || 2;
                    const prices = (data.history.prices as (string | number)[]).map(p => Number(p));
                    const digits = prices.map(p => Number(p.toFixed(pip).slice(-1)));
                    sd.ticks  = digits.slice(-MAX_TICKS);
                    sd.prices = prices.slice(-MAX_TICKS);
                    sd.ready  = sd.ticks.length >= MIN_TICKS_BEFORE_TRADE;
                    addLog(`Loaded ${digits.length} ticks — ${SYMBOL_LABELS[sym]}`, 'info');
                    break;
                }
                case 'tick': {
                    const tick = data.tick;
                    if (!tick) return;
                    const sym: string = tick.symbol;
                    if (!sym || !symbolDataRef.current[sym]) return;
                    const sd  = symbolDataRef.current[sym];
                    const pip = PIP_SIZES[sym] || tick.pip_size || 2;
                    const price = Number(tick.quote);
                    const digit = Number(price.toFixed(pip).slice(-1));
                    sd.ticks  = [...sd.ticks.slice(-(MAX_TICKS - 1)), digit];
                    sd.prices = [...sd.prices.slice(-(MAX_TICKS - 1)), price];
                    // Compute digit frequency from last 50 ticks (live) and 200 ticks (overall)
                    const recentTicks = sd.ticks.slice(-50);
                    const counts = new Array(10).fill(0);
                    recentTicks.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
                    const total = counts.reduce((a, v) => a + v, 0);
                    sd.recentDigitFreq = total > 0 ? counts.map(c => (c / total) * 10) : counts;

                    const allTicks = sd.ticks.slice(-200);
                    const allCounts = new Array(10).fill(0);
                    allTicks.forEach(d => { if (d >= 0 && d <= 9) allCounts[d]++; });
                    const allTotal = allCounts.reduce((a, v) => a + v, 0);
                    sd.digitFreq = allTotal > 0 ? allCounts.map(c => (c / allTotal) * 10) : allCounts;
                    sd.digitAnalysis = analyzeDigitPsychology(sd.ticks);
                    sd.ready  = sd.ticks.length >= MIN_TICKS_BEFORE_TRADE;
                    lastTickSymRef.current = sym;
                    onTickRef.current();
                    break;
                }
                case 'buy': {
                    const sym: string = data.echo_req?.parameters?.symbol;
                    if (!sym) return;
                    if (data.error) {
                        globalLock.current = false;
                        activeContractsRef.current = 0;
                        setActiveContracts(0);
                        return;
                    }
                    if (!data.buy) { globalLock.current = false; activeContractsRef.current = 0; setActiveContracts(0); return; }
                    const cid = String(data.buy.contract_id);
                    if (!cid || cid === 'undefined') { globalLock.current = false; activeContractsRef.current = 0; setActiveContracts(0); return; }
                    contractMapRef.current.set(cid, { symbol: sym, stake: globalStakeRef.current, strategyNames: ['ensemble'], duration: 1, barrier: String(data.echo_req?.parameters?.barrier ?? predictionDigitRef.current) });
                    addLog(`Contract ${cid} open on ${SYMBOL_LABELS[sym]}`, 'info');
                    break;
                }
                case 'proposal_open_contract': {
                    const c = data.proposal_open_contract;
                    if (!c?.is_sold) return;
                    const cid = String(c.contract_id);
                    const entry = contractMapRef.current.get(cid);
                    if (!entry) return;
                    contractMapRef.current.delete(cid);

                    const { symbol: sym, stake: tradeStake, strategyNames, duration, barrier } = entry;
                    const sd = symbolDataRef.current[sym];
                    if (!sd) return;

                    const profit = Number(c.profit);
                    const won = profit >= 0;

                    // Track barrier win rate
                    const barrierKey = `${sym}_${barrier}`;
                    if (!barrierHistoryRef.current.has(barrierKey)) barrierHistoryRef.current.set(barrierKey, { wins: 0, losses: 0 });
                    const bh = barrierHistoryRef.current.get(barrierKey)!;
                    if (won) bh.wins++; else bh.losses++;
                    if (bh.wins + bh.losses > 20) {
                        const ratio = bh.wins / (bh.wins + bh.losses);
                        bh.wins = Math.round(ratio * 10);
                        bh.losses = 10 - bh.wins;
                    }

                    strategyNames.forEach(n => recordOutcome(n, won));

                    pnlRef.current += profit;
                    setPnl(pnlRef.current);

                    try {
                        const pocWithDisplay = !(c as any).display_name ? { ...c, display_name: SYMBOL_LABELS[sym] } : c;
                        transactions.onBotContractEvent(pocWithDisplay);
                    } catch (_) {}

                    if (won) {
                        sd.wins++;
                        const wasInRecovery = inManualRecoveryRef.current;
                        if (wasInRecovery) {
                            inManualRecoveryRef.current = false;
                            recoverySymRef.current = '';
                            addLog(`✅ MANUAL RECOVERY WON — back to normal`, 'win');
                        }
                        consecutiveLossesRef.current = 0;
                        cooldownTicksRef.current = 0;
                        pausedRef.current = false;
                        globalStakeRef.current = stakeParsed.current;
                        addLog(`✅ WON +$${profit.toFixed(2)} on ${SYMBOL_LABELS[sym]} | Next stake reset to $${stakeParsed.current.toFixed(2)} | P&L $${pnlRef.current.toFixed(2)}`, 'win');
                    } else {
                        sd.losses++;
                        consecutiveLossesRef.current++;
                        globalStakeRef.current = Number((tradeStake * martingaleParsed.current).toFixed(2));
                    addLog(`❌ LOST -$${Math.abs(profit).toFixed(2)} on ${SYMBOL_LABELS[sym]} | Next stake $${globalStakeRef.current.toFixed(2)} | P&L $${pnlRef.current.toFixed(2)}`, 'loss');

                        if (recoveryRef.current) {
                            handleRecovery(sym, Math.abs(profit));
                            return;
                        }
                        if (manualRecoveryRef.current && consecutiveLossesRef.current >= manualRecoveryLossThresholdRef.current && !inManualRecoveryRef.current) {
                            inManualRecoveryRef.current = true;
                            signalHistoryRef.current = [];
                            addLog(`🔄 MANUAL RECOVERY — reversal entry | ${recoverySideRef.current === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${recoveryDigitRef.current} | Losing threshold: ${RECOVERY_LOSING_PCT_THRESHOLD}% | Entry: wait for losing digit to appear`, 'info');
                        }
                    }

                    flushDisplay(sym);
                    globalLock.current = false;
                    activeContractsRef.current = 0;
                    setActiveContracts(0);
                    checkLimits();
                    break;
                }
            }
        };

        const mws = openMakotiWS(
            handleMsg,
            () => {
                addLog('Live tick stream active — fetching historical ticks…', 'info');
                if (!window._newSystemWS) {
                    mws.send({ proposal_open_contract: 1, subscribe: 1 });
                }
                // Pre-fill tick buffers with historical data so trading starts immediately
                if (window._newSystemWS?.readyState === WebSocket.OPEN) {
                    ALL_SYMBOLS.forEach(sym => {
                        window._newSystemWS.send(JSON.stringify({ ticks_history: sym, count: 100, end: 'latest', style: 'ticks' }));
                    });
                }
            },
            () => {
                if (runningRef.current) {
                    addLog('Connection lost. Stopping.', 'info');
                    stopKiller();
                }
            }
        );
        wsRef.current = mws;
    }, [stake, martingale, takeProfit, stopLoss, predictionDigit, contractSide, recoveryMode, manualRecovery, recoverySide, recoveryDigit, recoveryLossThreshold, addLog, flushDisplay, checkLimits, stopKiller, onTickReceived]);

    const startKillerRef = useRef(startKiller);
    startKillerRef.current = startKiller;

    /* ── Auto-start on recovery return ──────────────────────────────────── */
    useEffect(() => {
        if (window.DBot?.__ou_auto_start) {
            window.DBot.__ou_auto_start = false;
            const cfg = window.DBot.__ou_config;
            if (cfg) {
                setStake(String(cfg.stake));
                setMartingale(String(cfg.martingale));
                setTakeProfit(String(cfg.takeProfit));
                setStopLoss(String(cfg.stopLoss));
                setPredictionDigit(String(cfg.predictionDigit));
                setContractSide(cfg.contractSide);
                setRecoveryMode(cfg.recoveryMode);
                if (cfg.manualRecovery !== undefined) {
                    setManualRecovery(cfg.manualRecovery);
                    setRecoverySide(cfg.recoverySide || 'DIGITOVER');
                    setRecoveryDigit(String(cfg.recoveryDigit ?? 5));
                }
                if (cfg.recoveryLossThreshold !== undefined) {
                    setRecoveryLossThreshold(String(cfg.recoveryLossThreshold));
                }
                window.DBot.__ou_config = null;
            }
            const t = setTimeout(() => startKillerRef.current(), 200);
            return () => clearTimeout(t);
        }
    }, []);

    /* ── Derived display values ──────────────────────────────────────────── */
    const totalWins   = Object.values(symbolDisplay).reduce((a, b) => a + b.wins,  0);
    const totalLosses = Object.values(symbolDisplay).reduce((a, b) => a + b.losses, 0);
    const totalTrades = totalWins + totalLosses;
    const winRate     = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(1) : '—';

    /* ── Render ──────────────────────────────────────────────────────────── */
    return (
        <div className='mw-killer over-under-theme'>
            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Stake ($)</label>
                    <input className='mw-input' type='number' min='0.35' step='0.01'
                        value={stake} onChange={e => setStake(e.target.value)} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Martingale ×</label>
                    <input className='mw-input' type='number' min='1' step='0.1'
                        value={martingale} onChange={e => setMartingale(e.target.value)} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Take Profit ($)</label>
                    <input className='mw-input' type='number' min='0.5' step='0.5'
                        value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Stop Loss ($)</label>
                    <input className='mw-input' type='number' min='0.5' step='0.5'
                        value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={running} />
                </div>
            </div>

            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Prediction Digit</label>
                    <input className='mw-input' type='number' min='0' max='9' step='1'
                        value={predictionDigit} onChange={e => setPredictionDigit(e.target.value)} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Contract Type</label>
                    <MwSelect value={contractSide} options={CONTRACT_SIDES.map(s => ({ value: s.value, label: s.label }))}
                        onChange={v => setContractSide(v as ContractSide)} disabled={running} />
                </div>
            </div>

            <div className='mw-killer__vh'>
                <label className='mw-killer__vh-toggle'>
                    <input type='checkbox' checked={recoveryMode}
                        onChange={e => setRecoveryMode(e.target.checked)} disabled={running} />
                    <span>Recovery Mode <small style={{opacity:0.6,fontWeight:400}}>(on loss → RF via Market Killer)</small></span>
                </label>
            </div>

            {recoveryMode && !running && (
                <div className='mw-killer__fields'>
                    <div className='mw-field'>
                        <label className='mw-label'>Recovery Virtual Loss Threshold</label>
                        <input className='mw-input' type='number' min='0' step='1'
                            value={recoveryLossThreshold}
                            onChange={e => setRecoveryLossThreshold(e.target.value)} />
                        <small style={{color:'#64748b',fontSize:'9px',marginTop:'2px'}}>Virtual losses before real trades. 0 = no virtual, start real immediately.</small>
                    </div>
                </div>
            )}

            {manualRecovery && !running && (
                <div className='mw-killer__fields'>
                    <div className='mw-field'>
                        <label className='mw-label'>Manual Recovery Loss Threshold</label>
                        <input className='mw-input' type='number' min='0' step='1'
                            value={manualRecoveryLossThreshold}
                            onChange={e => setManualRecoveryLossThreshold(e.target.value)} />
                        <small style={{color:'#64748b',fontSize:'9px',marginTop:'2px'}}>Real losses before switching to manual recovery mode.</small>
                    </div>
                </div>
            )}

            <div className='mw-killer__vh'>
                <label className='mw-killer__vh-toggle'>
                    <input type='checkbox' checked={manualRecovery}
                        onChange={e => setManualRecovery(e.target.checked)} disabled={running} />
                    <span>Manual Recovery <small style={{opacity:0.6,fontWeight:400}}>({manualRecoveryLossThreshold} loss{manualRecoveryLossThreshold !== '1' ? 'es' : ''} → switch side/digit)</small></span>
                </label>
            </div>

            {manualRecovery && !running && (
                <div className='mw-killer__fields'>
                    <div className='mw-field'>
                        <label className='mw-label'>Recovery Digit</label>
                        <input className='mw-input' type='number' min='0' max='9' step='1'
                            value={recoveryDigit} onChange={e => setRecoveryDigit(e.target.value)} />
                    </div>
                    <div className='mw-field'>
                        <label className='mw-label'>Recovery Side</label>
                        <MwSelect value={recoverySide} options={CONTRACT_SIDES.map(s => ({ value: s.value, label: s.label }))}
                            onChange={v => setRecoverySide(v as ContractSide)} />
                    </div>
                </div>
            )}

            <div className='mw-killer__vh'>
                <label className='mw-killer__vh-toggle'>
                    <input type='checkbox' checked={automate}
                        onChange={e => setAutomate(e.target.checked)} disabled={running} />
                    <span>Automate <small style={{opacity:0.6,fontWeight:400}}>(trade any signal, ignore config)</small></span>
                </label>
            </div>

            <button
                className={`mw-btn${running ? ' mw-btn--stop' : ' mw-btn--kill'}`}
                onClick={() => {
                    if (running && pausedRef.current) {
                        pausedRef.current = false;
                        consecutiveLossesRef.current = 0;
                        globalStakeRef.current = stakeParsed.current;
                        addLog('▶ Resumed after pause', 'info');
                    } else if (running) {
                        stopKiller();
                    } else {
                        startKiller();
                    }
                }}
            >
                {running
                    ? pausedRef.current
                        ? <><span className='mw-pulse' /> PAUSED — CLICK TO RESUME</>
                        : <><span className='mw-pulse' /> STOP KILLER</>
                    : '⚔ KILL MARKET'}
            </button>

            {running && (
                <div className='mw-killer__mode-note'>
                    {pausedRef.current
                        ? <span style={{color:'#ef4444'}}>⏸ PAUSED — {MAX_CONSECUTIVE_LOSSES} consecutive losses. Click button to resume.</span>
                        : inManualRecoveryRef.current
                        ? <span style={{color:'#f97316'}}>🔴 REVERSAL — {recoverySideRef.current === 'DIGITOVER' ? 'OVER' : 'UNDER'} {recoveryDigitRef.current} | &lt;{RECOVERY_LOSING_PCT_THRESHOLD}%</span>
                        : automateRef.current
                        ? <span style={{color:'#22c55e'}}>🤖 AUTOMATE — any signal / any barrier</span>
                        : <>Auto (Over/Under) — Digit {predictionDigitRef.current} {contractSide === 'DIGITOVER' ? 'OVER' : 'UNDER'}</>
                    }
                    {activeContracts > 0 && <span className='mw-killer__active-dot'> ● TRADE LIVE</span>}
                </div>
            )}

            {running && digitAnalysis && (
                <div className='mw-killer__digits'>
                    <div className='mw-killer__digits-head'>Digit Distribution (200 ticks)</div>
                    <div className='mw-scanner__bars' style={{height:32}}>
                        {digitAnalysis.freq.map((p, i) => (
                            <div key={i} className='mw-scanner__bar-wrap'
                                style={{opacity: i === digitAnalysis.streakDigit ? 1 : 0.6}}
                                title={`Digit ${i}: ${p.toFixed(1)}%`}>
                                <div className='mw-scanner__bar-fill'
                                    style={{
                                        height: `${Math.min(100, p * 2.5)}%`,
                                        background: i === digitAnalysis.streakDigit
                                            ? 'linear-gradient(to top, #f97316, #fb923c)'
                                            : 'linear-gradient(to top, #3b82f6, #60a5fa)',
                                    }} />
                                <span className='mw-scanner__bar-pct'>{p.toFixed(0)}%</span>
                                <span className='mw-scanner__bar-lbl' style={{fontSize:7}}>{i}</span>
                            </div>
                        ))}
                    </div>
                    <div className='mw-killer__digits-info'>
                        <span>Streak: {digitAnalysis.streakDigit}×{digitAnalysis.streakLen}</span>
                        <span>Dom: {digitAnalysis.dominantDigit}</span>
                        {digitAnalysis.reversalSignal && <span className='mw-killer__digits-rev'>REVERSAL</span>}
                    </div>
                </div>
            )}

            {running && signalDisplay && (
                <div className='mw-killer__signal'>
                    <div className='mw-killer__signal-row'>
                        <span className='mw-killer__signal-label'>Signal</span>
                        <span className='mw-killer__signal-val'>{signalDisplay.side === 'DIGITOVER' ? 'OVER' : 'UNDER'} @ {signalDisplay.barrier}</span>
                    </div>
                    <div className='mw-killer__signal-row'>
                        <span className='mw-killer__signal-label'>Confidence</span>
                        <span className='mw-killer__signal-val' style={{
                            color: signalDisplay.confidence >= 70 ? '#22c55e' : signalDisplay.confidence >= 55 ? '#eab308' : '#ef4444'
                        }}>{signalDisplay.confidence}%</span>
                    </div>
                    <div className='mw-killer__signal-detail'>{signalDisplay.strategies.slice(0, 80)}…</div>
                </div>
            )}

            {(running || totalTrades > 0) && (
                <div className='mw-killer__stats'>
                    <div className={`mw-killer__pnl${pnl >= 0 ? ' mw-killer__pnl--pos' : ' mw-killer__pnl--neg'}`}>
                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </div>
                    <div className='mw-killer__meta'>
                        <span>Trades: {totalTrades}</span>
                        <span>W/L: {totalWins}/{totalLosses}</span>
                        <span>Win rate: {winRate}%</span>
                        <span>Stake: ${globalStakeRef.current.toFixed(2)}</span>
                    </div>
                </div>
            )}

            {Object.keys(symbolDisplay).length > 0 && (
                <div className='mw-killer__symbols'>
                    {ALL_SYMBOLS.filter(s => symbolDisplay[s]).map(sym => {
                        const ss = symbolDisplay[sym];
                        const baseStake = parseFloat(stake) || 0.35;
                        const isMgActive = ss.stake > baseStake + 0.001;
                        return (
                            <div key={sym} className='mw-killer__sym-row'>
                                <span className='mw-killer__sym-name'>{SYMBOL_LABELS[sym]}</span>
                                <span className='mw-killer__sym-signal'>{ss.lastSignal}</span>
                                <span className='mw-killer__sym-wl'>
                                    <span className='mw-win'>{ss.wins}W</span>
                                    <span className='mw-loss'>{ss.losses}L</span>
                                </span>
                                {isMgActive && (
                                    <span className='mw-killer__sym-stake' title='Martingale stake'>
                                        ${ss.stake.toFixed(2)}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {logs.length > 0 && (
                <div className='mw-killer__log-wrap'>
                    <div className='mw-killer__log-header'>
                        <span className='mw-killer__log-title'>Activity Log</span>
                        <button className='mw-btn-clear' onClick={clearLogs} title='Clear log'>Clear</button>
                    </div>
                    <div className='mw-killer__log'>
                        {logs.map((l, i) => (
                            <div key={i} className={`mw-log-line mw-log-line--${l.type}`}>
                                <span className='mw-log-time'>{l.time}</span>
                                <span className='mw-log-msg'>{l.msg}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OverUnderKiller;
