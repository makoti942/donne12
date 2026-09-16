import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES, openMakotiWS, MakotiWS } from '../makoti-ws';
import { recordOutcome } from '../prediction-engine';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import { loadConfig, saveConfig } from './config';
import {
    BUY_TIMEOUT_MS,
    LS_LOGS_KEY,
    MAX_TICKS,
    MIN_TICKS,
    TRADE_COOLDOWN_MS,
} from './constants';
import type {
    ContractEntry,
    LogEntry,
    RecoveryState,
    SymbolDisplay,
    SymState,
    TradeDirection,
    VirtualTrade,
    VhState,
} from './types';

export interface MarketKillerEngine {
    running: boolean;
    pnl: number;
    logs: LogEntry[];
    symDisplay: Record<string, SymbolDisplay>;
    stake: string;
    martingale: string;
    takeProfit: string;
    stopLoss: string;
    vhEnabled: boolean;
    vhThreshold: string;
    maxDir: string;
    setStake: (v: string) => void;
    setMartingale: (v: string) => void;
    setTakeProfit: (v: string) => void;
    setStopLoss: (v: string) => void;
    setVhEnabled: (v: boolean) => void;
    setVhThreshold: (v: string) => void;
    setMaxDir: (v: string) => void;
    start: () => void;
    stop: () => void;
    clearLogs: () => void;
    getCurrentStake: () => number;
    getMaxDir: () => number;
    isVirtualMode: boolean;
}

const newSymState = (): SymState => ({
    ticks: [],
    prices: [],
    lastSignal: '\u2014',
    wins: 0,
    losses: 0,
    ready: false,
});

export const useMarketKiller = (): MarketKillerEngine => {
    const { transactions } = useStore();
    const initCfg = loadConfig();

    // --- Config (persisted to localStorage) ---
    const [stake, setStake] = useState(initCfg.stake);
    const [martingale, setMartingale] = useState(initCfg.martingale);
    const [takeProfit, setTakeProfit] = useState(initCfg.takeProfit);
    const [stopLoss, setStopLoss] = useState(initCfg.stopLoss);
    const [vhEnabled, setVhEnabled] = useState(initCfg.vhEnabled);
    const [vhThreshold, setVhThreshold] = useState(initCfg.vhThreshold);
    const [maxDir, setMaxDir] = useState(initCfg.maxDir);

    // --- UI state ---
    const [running, setRunning] = useState(false);
    const [pnl, setPnl] = useState(0);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [symDisplay, setSymDisplay] = useState<Record<string, SymbolDisplay>>({});

    // --- Mutable engine refs ---
    const wsRef = useRef<MakotiWS | null>(null);
    const runningRef = useRef(false);
    const pnlRef = useRef(0);
    const baseStakeRef = useRef(0.35);
    const mgRef = useRef(2);
    const tpRef = useRef(10);
    const slRef = useRef(5);
    const maxDirRef = useRef(3);
    const symDataRef = useRef<Record<string, SymState>>({});
    const tradeLockRef = useRef(false);
    const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const currentStakeRef = useRef(0.35);
    const contractMapRef = useRef<Map<string, ContractEntry>>(new Map());
    const vhStateRef = useRef<VhState>({ enabled: false, threshold: 1, isVirtual: false, lossCount: 0 });
    const virtualRef = useRef<VirtualTrade | null>(null);
    const dirRef = useRef<Record<string, { dir: 'up' | 'down' | null; count: number }>>({});
    const recoveryRef = useRef<RecoveryState | null>(null);
    const recoveryPnlRef = useRef(0);
    const startKillerRef = useRef<() => void>(() => {});

    // --- Config persistence ---
    useEffect(() => {
        saveConfig({ stake, martingale, takeProfit, stopLoss, vhEnabled, vhThreshold, maxDir });
    }, [stake, martingale, takeProfit, stopLoss, vhEnabled, vhThreshold, maxDir]);

    // --- Logging ---
    const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 150));
    }, []);

    const clearLogs = useCallback(() => {
        setLogs([]);
        try {
            localStorage.removeItem(LS_LOGS_KEY);
        } catch {}
    }, []);

    // --- Per-symbol display flush ---
    const flushSym = useCallback((sym: string) => {
        const sd = symDataRef.current[sym];
        if (!sd) return;
        const d = dirRef.current[sym] || { dir: null, count: 0 };
        const lastPrice = sd.prices[sd.prices.length - 1];
        const pip = PIP_SIZES[sym] || 2;
        const digit = lastPrice != null ? Number(lastPrice.toFixed(pip).slice(-1)) : null;
        setSymDisplay(prev => ({
            ...prev,
            [sym]: {
                label: SYMBOL_LABELS[sym],
                lastSignal: sd.lastSignal,
                wins: sd.wins,
                losses: sd.losses,
                dir: d.dir,
                dirCount: d.count,
                stake: currentStakeRef.current,
                digit,
            },
        }));
    }, []);

    const flushAllSyms = useCallback(() => {
        ALL_SYMBOLS.forEach(sym => flushSym(sym));
    }, [flushSym]);

    // --- Direction streak tracking ---
    const updateDir = useCallback((sym: string, prices: number[]) => {
        if (prices.length < 2) return;
        const last = prices[prices.length - 1];
        const prev = prices[prices.length - 2];
        const cur = dirRef.current[sym] || { dir: null, count: 0 };
        if (last > prev) {
            if (cur.dir === 'up') cur.count++;
            else {
                cur.dir = 'up';
                cur.count = 1;
            }
        } else if (last < prev) {
            if (cur.dir === 'down') cur.count++;
            else {
                cur.dir = 'down';
                cur.count = 1;
            }
        } else {
            cur.count = 0;
            cur.dir = null;
        }
        dirRef.current[sym] = cur;
    }, []);

    // --- Limits ---
    const stopKiller = useCallback(() => {
        runningRef.current = false;
        tradeLockRef.current = false;
        virtualRef.current = null;
        if (cooldownTimerRef.current) {
            clearTimeout(cooldownTimerRef.current);
            cooldownTimerRef.current = null;
        }
        setRunning(false);
        try {
            wsRef.current?.close();
        } catch {}
        wsRef.current = null;
        addLog('Market Killer stopped.', 'info');
    }, [addLog]);

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
    }, [addLog, stopKiller]);

    // --- Virtual trades ---
    const startVirtualTrade = useCallback(
        (sym: string, direction: TradeDirection, stakeAmt: number) => {
            const buyId = `vt_${sym}_${Date.now()}`;
            const sd = symDataRef.current[sym];
            const entryPrice = sd ? sd.prices[sd.prices.length - 1] : 0;
            virtualRef.current = {
                symbol: sym,
                entryPrice,
                direction,
                stake: stakeAmt,
                startTime: Math.floor(Date.now() / 1000),
                buyId,
                ticksElapsed: 0,
                resolved: false,
            };
            const label = direction === 'CALL' ? 'RISE' : 'FALL';
            addLog(`🤖 VIRTUAL ${label} ${SYMBOL_LABELS[sym]} @ $${stakeAmt.toFixed(2)} — tracking`, 'trade');
            try {
                transactions.onBotContractEvent({
                    transaction_ids: { buy: buyId },
                    contract_id: buyId,
                    buy_price: stakeAmt,
                    currency: 'USD',
                    contract_type: direction,
                    underlying: sym,
                    display_name: SYMBOL_LABELS[sym],
                    date_start: Math.floor(Date.now() / 1000),
                    entry_tick_time: Math.floor(Date.now() / 1000),
                    tick_count: 1,
                    status: 'open',
                    is_virtual: true,
                } as any);
            } catch {}
        },
        [addLog, transactions]
    );

    const resolveVirtualTrade = useCallback(
        (sym: string, exitPrice: number) => {
            const vt = virtualRef.current;
            if (!vt || vt.symbol !== sym) return;
            const won = vt.direction === 'CALL' ? exitPrice > vt.entryPrice : exitPrice < vt.entryPrice;
            const label = vt.direction === 'CALL' ? 'RISE' : 'FALL';
            const profit = won ? vt.stake * 0.95 : -vt.stake;
            const sellPrice = won ? vt.stake * 1.95 : 0;
            const pip = PIP_SIZES[vt.symbol] || 2;
            try {
                transactions.onBotContractEvent({
                    transaction_ids: { buy: vt.buyId },
                    contract_id: vt.buyId,
                    buy_price: vt.stake,
                    sell_price: sellPrice,
                    currency: 'USD',
                    contract_type: vt.direction,
                    underlying: vt.symbol,
                    display_name: won ? 'Virtual Win' : 'Virtual Loss',
                    date_start: vt.startTime,
                    date_expiry: Math.floor(Date.now() / 1000),
                    entry_spot: vt.entryPrice.toFixed(pip),
                    entry_tick: vt.entryPrice.toFixed(pip),
                    entry_tick_time: vt.startTime,
                    exit_spot: exitPrice.toFixed(pip),
                    exit_tick: exitPrice.toFixed(pip),
                    exit_tick_time: Math.floor(Date.now() / 1000),
                    profit,
                    is_sold: true,
                    is_completed: true,
                    status: 'sold',
                    is_virtual: true,
                } as any);
            } catch {}
            const sd = symDataRef.current[sym];
            if (won) {
                if (sd) sd.wins++;
                vhStateRef.current.lossCount = 0;
                currentStakeRef.current = baseStakeRef.current;
                addLog(
                    `🤖 ✅ VIRTUAL WIN +$${profit.toFixed(2)} on ${SYMBOL_LABELS[sym]} — Entry $${vt.entryPrice.toFixed(4)} → Exit $${exitPrice.toFixed(4)}`,
                    'win'
                );
                if (vhStateRef.current.enabled && !vhStateRef.current.isVirtual) {
                    vhStateRef.current.isVirtual = true;
                    vhStateRef.current.lossCount = 0;
                    addLog(`🤖 🔄 Real WIN — switching back to VIRTUAL mode`, 'recovery');
                }
            } else {
                if (sd) sd.losses++;
                vhStateRef.current.lossCount++;
                // Virtual losses never martingale — stake stays at base.
                addLog(
                    `🤖 ❌ VIRTUAL LOSS -$${Math.abs(profit).toFixed(2)} on ${SYMBOL_LABELS[sym]} #${vhStateRef.current.lossCount}/${vhStateRef.current.threshold} — Entry $${vt.entryPrice.toFixed(4)} → Exit $${exitPrice.toFixed(4)}`,
                    'loss'
                );
                if (vhStateRef.current.lossCount >= vhStateRef.current.threshold) {
                    vhStateRef.current.isVirtual = false;
                    currentStakeRef.current = baseStakeRef.current;
                    addLog(`🤖 🔄 THRESHOLD REACHED (${vhStateRef.current.lossCount} virtual losses) — switching to REAL trades | Stake reset to $${baseStakeRef.current.toFixed(2)}`, 'recovery');
                }
            }
            virtualRef.current = null;
            flushSym(sym);
            tradeLockRef.current = true;
            cooldownTimerRef.current = setTimeout(() => {
                tradeLockRef.current = false;
                cooldownTimerRef.current = null;
                if (runningRef.current) {
                    flushAllSyms();
                    checkLimits();
                }
            }, TRADE_COOLDOWN_MS);
        },
        [addLog, transactions, flushSym, flushAllSyms, checkLimits]
    );

    // --- Real trades ---
    const executeBuy = useCallback(
        async (sym: string, direction: TradeDirection): Promise<boolean> => {
            if (!runningRef.current) return false;
            if (window._newSystemWS?.readyState !== WebSocket.OPEN) {
                addLog(`WebSocket not open — skipping ${SYMBOL_LABELS[sym]}`, 'info');
                return false;
            }
            const tradeStake = Number(currentStakeRef.current.toFixed(2));
            const label = direction === 'CALL' ? 'RISE' : 'FALL';
            addLog(`🎯 ${SYMBOL_LABELS[sym]}: ${label} @ $${tradeStake.toFixed(2)}`, 'trade');
            const params = {
                amount: tradeStake,
                basis: 'stake',
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: sym,
                contract_type: direction,
            };
            try {
                const response = await Promise.race([
                    sendViaNewSystemWithPromise({ buy: 1, price: tradeStake, parameters: params }),
                    new Promise<null>((_, reject) =>
                        setTimeout(() => reject(new Error('Buy timeout')), BUY_TIMEOUT_MS)
                    ),
                ]);
                const contractId =
                    (response as any)?.buy?.contract_id ?? (response as any)?.contract_id;
                if (contractId) {
                    contractMapRef.current.set(String(contractId), {
                        symbol: sym,
                        stake: tradeStake,
                        strategyNames: ['tick_direction'],
                        transactionId: (response as any)?.buy?.transaction_id,
                    });
                    addLog(`Contract ${contractId} open on ${SYMBOL_LABELS[sym]}`, 'info');
                    try {
                        transactions.onBotContractEvent({
                            contract_id: contractId,
                            transaction_ids: { buy: (response as any)?.buy?.transaction_id ?? contractId },
                            buy_price: tradeStake,
                            currency: 'USD',
                            contract_type: direction,
                            underlying: sym,
                            display_name: SYMBOL_LABELS[sym],
                            date_start: Math.floor(Date.now() / 1000),
                            status: 'open',
                        } as any);
                    } catch {}
                    const sd = symDataRef.current[sym];
                    if (sd) sd.lastSignal = label;
                    flushSym(sym);
                    return true;
                } else {
                    addLog(`Buy ok but no contract_id for ${SYMBOL_LABELS[sym]}`, 'info');
                    tradeLockRef.current = false;
                    return false;
                }
            } catch (err: any) {
                addLog(
                    `Buy error ${SYMBOL_LABELS[sym]}: ${err?.error?.message || err?.message || 'timeout'}`,
                    'loss'
                );
                tradeLockRef.current = false;
                return false;
            }
        },
        [addLog, transactions, flushSym]
    );

    // --- Sold-contract handling ---
    const processContractSold = useCallback(
        (contractId: string, c: any) => {
            const entry = contractMapRef.current.get(contractId);
            if (!entry) return;
            contractMapRef.current.delete(contractId);
            const profit = Number(c.profit);
            const { symbol: sym, stake: tradeStake, strategyNames, transactionId } = entry;
            const won = profit >= 0;
            const sd = symDataRef.current[sym];
            strategyNames.forEach(n => recordOutcome(n, won));
            pnlRef.current += profit;
            setPnl(pnlRef.current);
            try {
                transactions.onBotContractEvent({
                    ...c,
                    contract_id: contractId,
                    transaction_ids: { buy: transactionId ?? contractId },
                    display_name: c.display_name ?? SYMBOL_LABELS[sym],
                    status: 'sold',
                } as any);
            } catch {}
            if (won) {
                if (sd) sd.wins++;
                currentStakeRef.current = baseStakeRef.current;
                addLog(
                    `✅ WON +$${profit.toFixed(2)} on ${SYMBOL_LABELS[sym]} — stake reset | P&L $${pnlRef.current.toFixed(2)}`,
                    'win'
                );
                if (vhStateRef.current.enabled && !vhStateRef.current.isVirtual) {
                    vhStateRef.current.isVirtual = true;
                    vhStateRef.current.lossCount = 0;
                    addLog(`🤖 🔄 Real WIN — switching back to VIRTUAL mode`, 'recovery');
                }
            } else {
                if (sd) sd.losses++;
                const nextStake = Math.min(Number((tradeStake * mgRef.current).toFixed(2)), 10);
                currentStakeRef.current = nextStake;
                addLog(
                    `❌ LOST -$${Math.abs(profit).toFixed(2)} on ${SYMBOL_LABELS[sym]} — next stake $${nextStake.toFixed(2)} | P&L $${pnlRef.current.toFixed(2)}`,
                    'loss'
                );
            }
            if (recoveryRef.current) {
                recoveryPnlRef.current += profit;
                if (recoveryPnlRef.current >= 0) {
                    addLog(`🔄 RECOVERY COMPLETE — returning to Over/Under`, 'win');
                    window.DBot.__recovery = null;
                    stopKiller();
                    if (typeof window.DBot.__switchToTab === 'function') {
                        window.DBot.__ou_auto_start = true;
                        window.DBot.__switchToTab('over_under');
                    }
                    return;
                }
                addLog(`🔄 Recovery progress: $${recoveryPnlRef.current.toFixed(2)} / $0.00`, 'info');
            }
            flushSym(sym);
            tradeLockRef.current = true;
            cooldownTimerRef.current = setTimeout(() => {
                tradeLockRef.current = false;
                cooldownTimerRef.current = null;
                if (runningRef.current) {
                    flushAllSyms();
                    checkLimits();
                }
            }, TRADE_COOLDOWN_MS);
        },
        [addLog, transactions, flushSym, flushAllSyms, stopKiller, checkLimits]
    );

    // --- Per-symbol tick subscriptions (self-sufficient, like under-under-market) ---
    const subscribeAllSymbols = useCallback(() => {
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) return;
        ALL_SYMBOLS.forEach(sym => {
            window._newSystemWS.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: 50, end: 'latest', subscribe: 1 }));
        });
    }, []);

    // --- Sold-contract subscription (proposal_open_contract) ---
    const subscribePOC = useCallback(() => {
        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            window._newSystemWS.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));
        }
    }, []);

    useEffect(() => {
        if (!running) return;
        subscribePOC();
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'proposal_open_contract') return;
                const c = data.proposal_open_contract;
                if (!c?.is_sold) return;
                const cid = String(c.contract_id);
                if (!contractMapRef.current.has(cid)) return;
                processContractSold(cid, c);
            } catch {}
        });
        return () => {
            unsub();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running, processContractSold, subscribePOC]);

    // --- Per-tick engine (assigned on every render, like the original) ---
    const onTickRef = useRef<() => void>(() => {});
    onTickRef.current = () => {
        if (!runningRef.current) return;

        ALL_SYMBOLS.forEach(sym => {
            const sd = symDataRef.current[sym];
            if (!sd || sd.ticks.length < MIN_TICKS) return;
            updateDir(sym, sd.prices);
            flushSym(sym);
        });

        if (virtualRef.current) {
            const vt = virtualRef.current;
            const sd = symDataRef.current[vt.symbol];
            if (sd) {
                vt.ticksElapsed++;
                if (vt.ticksElapsed >= 1 && !vt.resolved) {
                    vt.resolved = true;
                    const exitPrice = sd.prices[sd.prices.length - 1];
                    resolveVirtualTrade(vt.symbol, exitPrice);
                }
            }
            return;
        }

        if (tradeLockRef.current) return;

        ALL_SYMBOLS.forEach(sym => {
            if (tradeLockRef.current) return;
            const sd = symDataRef.current[sym];
            if (!sd || sd.ticks.length < MIN_TICKS) return;
            const d = dirRef.current[sym] || { dir: null, count: 0 };
            if (d.count >= maxDirRef.current && d.dir) {
                const direction = d.dir === 'up' ? 'PUT' : 'CALL';
                const label = direction === 'CALL' ? 'RISE' : 'FALL';
                addLog(`TRIGGER ${SYMBOL_LABELS[sym]}: ${d.dir} ${d.count}x → ${label}`, 'trigger');
                dirRef.current[sym] = { dir: null, count: 0 };
                tradeLockRef.current = true;
                if (vhStateRef.current.enabled && vhStateRef.current.isVirtual) {
                    startVirtualTrade(sym, direction, currentStakeRef.current);
                } else {
                    executeBuy(sym, direction).catch(() => {
                        tradeLockRef.current = false;
                    });
                }
            }
        });
    };

    // --- Start ---
    const startKiller = useCallback(() => {
        const stakeVal = Math.max(0.35, parseFloat(stake) || 0.35);
        const mgVal = Math.max(1, parseFloat(martingale) || 2);
        const tpVal = Math.max(0.5, parseFloat(takeProfit) || 10);
        const slVal = Math.max(0.5, parseFloat(stopLoss) || 5);
        const mdVal = Math.max(2, parseInt(maxDir) || 3);

        baseStakeRef.current = stakeVal;
        mgRef.current = mgVal;
        tpRef.current = tpVal;
        slRef.current = slVal;
        maxDirRef.current = mdVal;
        currentStakeRef.current = stakeVal;
        pnlRef.current = 0;
        tradeLockRef.current = false;
        virtualRef.current = null;
        contractMapRef.current.clear();
        dirRef.current = {};
        recoveryPnlRef.current = 0;
        if (cooldownTimerRef.current) {
            clearTimeout(cooldownTimerRef.current);
            cooldownTimerRef.current = null;
        }

        vhStateRef.current = {
            enabled: vhEnabled,
            threshold: Math.max(1, parseInt(vhThreshold) || 1),
            isVirtual: vhEnabled,
            lossCount: 0,
        };
        if (vhEnabled) {
            addLog(`🤖 Virtual Hook ON — ${vhStateRef.current.threshold} virtual losses before real trades`, 'recovery');
        }

        const recovery = window.DBot?.__recovery as RecoveryState | null | undefined;
        recoveryRef.current = null;
        recoveryPnlRef.current = 0;
        if (recovery?.active) {
            const vhThresh = Math.max(0, recovery.vhThreshold ?? 1);
            baseStakeRef.current = recovery.stake;
            mgRef.current = recovery.martingale;
            currentStakeRef.current = recovery.stake;
            recoveryPnlRef.current = -recovery.pending;
            recoveryRef.current = recovery;
            vhStateRef.current = {
                enabled: vhThresh > 0,
                threshold: vhThresh || 1,
                isVirtual: vhThresh > 0,
                lossCount: 0,
            };
            addLog(
                `🔄 RECOVERY MODE — recover $${recovery.pending.toFixed(2)} | stake $${recovery.stake} x${recovery.martingale}`,
                'recovery'
            );
        }

        symDataRef.current = {};
        ALL_SYMBOLS.forEach(sym => {
            symDataRef.current[sym] = newSymState();
        });
        setSymDisplay({});

        runningRef.current = true;
        setRunning(true);
        setPnl(0);
        setLogs([]);
        addLog(`⚔ MARKET KILLER | stake $${stakeVal} MG x${mgVal} TP $${tpVal} SL $${slVal} | dir trigger: ${mdVal}`, 'info');

        if (wsRef.current) {
            try {
                wsRef.current.close();
            } catch {}
            wsRef.current = null;
        }

        const handleMsg = (data: any) => {
            if (!runningRef.current) return;
            if (data.error?.msg_type === 'buy') {
                addLog(`Buy error: ${data.error.message}`, 'info');
                tradeLockRef.current = false;
                return;
            }
            if (data.error) return;
            switch (data.msg_type) {
                case 'history': {
                    const sym: string = data.echo_req?.ticks_history;
                    if (!sym || !symDataRef.current[sym]) return;
                    const sd = symDataRef.current[sym];
                    const pip = PIP_SIZES[sym] || 2;
                    const prices = (data.history.prices as (string | number)[]).map(p => Number(p));
                    sd.ticks = prices.map(p => Number(p.toFixed(pip).slice(-1))).slice(-MAX_TICKS);
                    sd.prices = prices.slice(-MAX_TICKS);
                    sd.ready = sd.ticks.length >= MIN_TICKS;
                    addLog(`Loaded ${sd.ticks.length} ticks — ${SYMBOL_LABELS[sym]}`, 'info');
                    break;
                }
                case 'tick': {
                    const tick = data.tick;
                    if (!tick) return;
                    const sym: string = tick.symbol;
                    if (!sym || !symDataRef.current[sym]) return;
                    const sd = symDataRef.current[sym];
                    const pip = PIP_SIZES[sym] || tick.pip_size || 2;
                    const price = Number(tick.quote);
                    const digit = Number(price.toFixed(pip).slice(-1));
                    sd.ticks = [...sd.ticks.slice(-(MAX_TICKS - 1)), digit];
                    sd.prices = [...sd.prices.slice(-(MAX_TICKS - 1)), price];
                    sd.ready = sd.ticks.length >= MIN_TICKS;
                    onTickRef.current();
                    break;
                }
                case 'buy': {
                    if (data.error) {
                        addLog(`Buy error: ${data.error.message}`, 'info');
                        tradeLockRef.current = false;
                        return;
                    }
                    if (!data.buy) {
                        tradeLockRef.current = false;
                        return;
                    }
                    const cid = String(data.buy.contract_id);
                    if (!cid || cid === 'undefined') {
                        tradeLockRef.current = false;
                        return;
                    }
                    const sym: string = data.echo_req?.parameters?.symbol;
                    if (sym) {
                        const prev = contractMapRef.current.get(cid);
                        contractMapRef.current.set(cid, {
                            symbol: sym,
                            stake: currentStakeRef.current,
                            strategyNames: ['tick_direction'],
                            transactionId: data.buy?.transaction_id ?? prev?.transactionId,
                        });
                    }
                    break;
                }
            }
        };

        const mws = openMakotiWS(
            handleMsg,
            () => {
                addLog('Connected — live tick stream active', 'info');
                subscribeAllSymbols();
            },
            () => {
                if (runningRef.current) {
                    addLog('Connection lost. Stopping.', 'info');
                    stopKiller();
                }
            }
        );
        wsRef.current = mws;
        subscribeAllSymbols();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stake, martingale, takeProfit, stopLoss, vhEnabled, vhThreshold, maxDir, addLog, stopKiller, subscribeAllSymbols]);

    startKillerRef.current = startKiller;

    // --- Auto-start on recovery handoff ---
    useEffect(() => {
        if (window.DBot?.__recovery_auto_start) {
            window.DBot.__recovery_auto_start = false;
            const t = setTimeout(() => startKillerRef.current(), 150);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        running,
        pnl,
        logs,
        symDisplay,
        stake,
        martingale,
        takeProfit,
        stopLoss,
        vhEnabled,
        vhThreshold,
        maxDir,
        setStake,
        setMartingale,
        setTakeProfit,
        setStopLoss,
        setVhEnabled,
        setVhThreshold,
        setMaxDir,
        start: startKiller,
        stop: stopKiller,
        clearLogs,
        getCurrentStake: () => currentStakeRef.current,
        getMaxDir: () => maxDirRef.current,
        isVirtualMode: vhStateRef.current.enabled && vhStateRef.current.isVirtual,
    };
};
