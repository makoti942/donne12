import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ALL_SYMBOLS } from '@/components/makoti-widget/makoti-ws';
import { onNewSystemMessage, sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import './makoti-widget.scss';

type MultiKillerStrategy =
    | 'over'
    | 'under'
    | 'rise'
    | 'fall'
    | 'differs'
    | 'only_ups'
    | 'only_downs';

const LABELS: Record<MultiKillerStrategy, string> = {
    over: 'Over', under: 'Under', rise: 'Rise', fall: 'Fall',
    differs: 'Differs',
    only_ups: 'Only Ups', only_downs: 'Only Downs',
};

const CONTRACT_TYPE: Record<MultiKillerStrategy, string> = {
    over: 'DIGITOVER', under: 'DIGITUNDER', rise: 'CALL', fall: 'PUT',
    differs: 'DIGITDIFF',
    only_ups: 'RUNHIGH', only_downs: 'RUNLOW',
};

const DURATION: Record<MultiKillerStrategy, number> = {
    over: 1, under: 1, rise: 1, fall: 1, differs: 1,
    only_ups: 2, only_downs: 2,
};

const NEEDS_BARRIER: Record<MultiKillerStrategy, boolean> = {
    over: true, under: true, rise: false, fall: false,
    differs: true, only_ups: false, only_downs: false,
};

const HAS_DELAY: Record<MultiKillerStrategy, boolean> = {
    over: false, under: false, rise: true, fall: true,
    differs: false, only_ups: false, only_downs: false,
};

const USES_TICK_DIR: Record<MultiKillerStrategy, boolean> = {
    over: false, under: false, rise: true, fall: true,
    differs: false, only_ups: true, only_downs: true,
};

let _buySeq = 0;

interface TradeEntry {
    contractId: string;
    strategy: MultiKillerStrategy;
    stake: number;
    roundId: number;
}

interface PendingDelay {
    ticksNeeded: number;
    resolve: () => void;
    gen: number;
}

export const MultiKiller: React.FC = () => {
    const { transactions } = useStore();
    const STORAGE_KEY = 'makoti_multikiller_config';
    const loadConfig = () => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
    };
    const cfg = loadConfig();

    const [market, setMarket] = useState(cfg.market || 'R_100');
    const [selected, setSelected] = useState<MultiKillerStrategy[]>(cfg.selected || []);
    const [stakes, setStakes] = useState<Record<string, string>>(cfg.stakes || {});
    const [barriers, setBarriers] = useState<Record<string, string>>(cfg.barriers || {
        over: '5', under: '5', differs: '5',
    });
    const [delays, setDelays] = useState<Record<string, number>>(cfg.delays || {
        rise: 0, fall: 0,
    });
    const [tickDirection, setTickDirection] = useState(cfg.tickDirection || '0');
    const [tickDirMode, setTickDirMode] = useState<'any' | 'ups' | 'downs'>(cfg.tickDirMode || 'any');
    const [accuracy, setAccuracy] = useState(cfg.accuracy ?? false);
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [runPhase, setRunPhase] = useState<'idle' | 'waiting' | 'buying' | 'settling'>('idle');
    const [buyProgress, setBuyProgress] = useState({ done: 0, total: 0 });
    const [settleProgress, setSettleProgress] = useState({ done: 0, total: 0 });
    const [tickProgress, setTickProgress] = useState({ dir: '...', count: 0, target: 0 });
    const [analyzing, setAnalyzing] = useState(false);
    const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Persist config to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            market, selected, stakes, barriers, delays, tickDirection, tickDirMode, accuracy,
        }));
    }, [market, selected, stakes, barriers, delays, tickDirection, tickDirMode, accuracy]);

    // Auto-sync paired contracts: rise↔fall share delays, ups↔downs share stakes
    useEffect(() => {
        const hasRise = selected.includes('rise');
        const hasFall = selected.includes('fall');
        const hasUps = selected.includes('ups');
        const hasDowns = selected.includes('downs');
        if (hasRise && hasFall) {
            setDelays(p => {
                const r = p.rise ?? 0;
                const f = p.fall ?? 0;
                if (r !== f) return { ...p, fall: r };
                return p;
            });
        }
        if (hasUps && hasDowns) {
            setStakes(p => {
                const u = p.ups ?? '';
                const d = p.downs ?? '';
                if (u && !d) return { ...p, downs: u };
                if (d && !u) return { ...p, ups: d };
                return p;
            });
        }
    }, [selected]);

    const tradesRef = useRef<TradeEntry[]>([]);
    const runningRef = useRef(false);
    const selectedRef = useRef<MultiKillerStrategy[]>([]);
    const stakesRef = useRef<Record<string, string>>({});
    const barriersRef = useRef<Record<string, string>>({ over: '5', under: '5', differs: '5' });
    const delaysRef = useRef<Record<string, number>>({ rise: 0, fall: 0 });
    const genRef = useRef(0);
    const roundIdRef = useRef(0);
    const pendingDelaysRef = useRef<PendingDelay[]>([]);
    const buyListenersRef = useRef<Array<() => void>>([]);

    // Tick direction tracking
    const lastTickPriceRef = useRef<number | null>(null);
    const consecutiveUpRef = useRef(0);
    const consecutiveDownRef = useRef(0);
    const tickDirResolveRef = useRef<(() => void) | null>(null);
    const tickDirTargetRef = useRef(0);
    const tickDirActiveRef = useRef(false);
    const tickDirModeRef = useRef<'any' | 'ups' | 'downs'>('any');
    const accuracyRef = useRef(false);
    const recentPricesRef = useRef<number[]>([]);

    // Round lifecycle
    const expectedSettlementsRef = useRef(0);
    const settledCountRef = useRef(0);
    const buyPhaseDoneRef = useRef(false);
    const roundCompleteResolveRef = useRef<(() => void) | null>(null);

    const log = useCallback((msg: string) => {
        const t = new Date().toLocaleTimeString();
        setLogs(p => [`[${t}] ${msg}`, ...p].slice(0, 80));
    }, []);

    // Keep refs in sync
    useEffect(() => { selectedRef.current = selected; }, [selected]);
    useEffect(() => { stakesRef.current = stakes; }, [stakes]);
    useEffect(() => { barriersRef.current = barriers; }, [barriers]);
    useEffect(() => { delaysRef.current = delays; }, [delays]);
    useEffect(() => { tickDirModeRef.current = tickDirMode; }, [tickDirMode]);
    useEffect(() => { accuracyRef.current = accuracy; }, [accuracy]);

    const showTickDir = selected.some(s => USES_TICK_DIR[s]);
    const hasDirectional = selected.some(s => ['rise', 'fall', 'ups', 'downs'].includes(s));

    // RSI(3) calculation from recent tick prices
    const calcRSI = useCallback((prices: number[]): number => {
        if (prices.length < 4) return 50;
        let gains = 0;
        let losses = 0;
        for (let i = prices.length - 3; i < prices.length; i++) {
            if (i <= 0) continue;
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff;
            else if (diff < 0) losses += Math.abs(diff);
        }
        if (losses === 0 && gains === 0) return 50;
        if (losses === 0) return 100;
        const rs = gains / losses;
        return 100 - 100 / (1 + rs);
    }, []);

    // EMA stretch — how far price is from its EMA (as multiplier of recent range)
    const calcEMAStretch = useCallback((prices: number[]): number => {
        if (prices.length < 10) return 0;
        const emaPeriod = 9;
        let ema = prices[0];
        const k = 2 / (emaPeriod + 1);
        for (let i = 1; i < prices.length; i++) {
            ema = prices[i] * k + ema * (1 - k);
        }
        const lastPrice = prices[prices.length - 1];
        const distance = Math.abs(lastPrice - ema);
        // Normalize by average recent move
        let avgMove = 0;
        for (let i = 1; i < prices.length; i++) {
            avgMove += Math.abs(prices[i] - prices[i - 1]);
        }
        avgMove /= (prices.length - 1);
        return avgMove > 0 ? distance / avgMove : 0;
    }, []);

    // Check if accuracy conditions are met (2-of-3 indicators)
    const checkAccuracy = useCallback((direction: 'up' | 'down'): boolean => {
        const prices = recentPricesRef.current;
        if (prices.length < 4) return true;
        const rsi = calcRSI(prices);
        const stretch = calcEMAStretch(prices);
        const lastPrice = prices[prices.length - 1];
        const slice10 = prices.slice(-10);
        const range = Math.max(...slice10) - Math.min(...slice10);
        const atHigh = range > 0 && (lastPrice - Math.min(...slice10)) / range > 0.85;
        const atLow = range > 0 && (Math.max(...slice10) - lastPrice) / range > 0.85;

        let passed = 0;
        if (direction === 'up') {
            if (rsi > 70) passed++;
            if (stretch > 1.0) passed++;
            if (atHigh) passed++;
        } else {
            if (rsi < 30) passed++;
            if (stretch > 1.0) passed++;
            if (atLow) passed++;
        }
        return passed >= 2;
    }, [calcRSI, calcEMAStretch]);

    // Tick listener — handles tick delays AND tick direction
    useEffect(() => {
        if (!running) return;

        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'tick') return;
                const price = parseFloat(data.tick?.quote ?? data.tick?.bid ?? data.tick?.ask);
                if (isNaN(price)) return;

                // ── Always update lastTickPrice for next comparison ──
                const prevPrice = lastTickPriceRef.current;
                lastTickPriceRef.current = price;

                // ── Store recent prices for indicator calculations ──
                recentPricesRef.current.push(price);
                if (recentPricesRef.current.length > 100) recentPricesRef.current.shift();

                // ── Tick delay resolution (Rise/Fall 0t/1t/2t) ──
                const pending = pendingDelaysRef.current;
                for (let i = pending.length - 1; i >= 0; i--) {
                    const p = pending[i];
                    if (p.gen !== genRef.current) {
                        pending.splice(i, 1);
                        continue;
                    }
                    p.ticksNeeded--;
                    if (p.ticksNeeded <= 0) {
                        pending.splice(i, 1);
                        p.resolve();
                    }
                }

                // ── Tick direction tracking ──
                if (!tickDirActiveRef.current) return;
                if (prevPrice === null) {
                    log(`📊 Baseline: ${price}`);
                    return;
                }

                const target = tickDirTargetRef.current;
                if (target <= 0 || !tickDirResolveRef.current) return;

                const diff = price - prevPrice;
                const mode = tickDirModeRef.current;

                if (diff > 0) {
                    if (mode !== 'downs') {
                        consecutiveUpRef.current++;
                    }
                    consecutiveDownRef.current = 0;
                } else if (diff < 0) {
                    if (mode !== 'ups') {
                        consecutiveDownRef.current++;
                    }
                    consecutiveUpRef.current = 0;
                }
                // diff === 0: no change to counters

                const upCount = consecutiveUpRef.current;
                const downCount = consecutiveDownRef.current;

                if (upCount >= target) {
                    const accuracyOn = accuracyRef.current;
                    if (accuracyOn) {
                        const prices = recentPricesRef.current;
                        const rsi = calcRSI(prices);
                        const stretch = calcEMAStretch(prices);
                        const lastP = prices[prices.length - 1];
                        const mn = Math.min(...prices.slice(-10));
                        const mx = Math.max(...prices.slice(-10));
                        const rng = mx - mn;
                        const atHigh = rng > 0 && (lastP - mn) / rng > 0.85;
                        const atLow = rng > 0 && (mx - lastP) / rng > 0.85;
                        let cnt = 0;
                        if (rsi > 70) cnt++; else if (rsi < 30) cnt++;
                        if (stretch > 1.0) cnt++;
                        if (atHigh) cnt++;
                        log(`  📐 RSI: ${rsi.toFixed(1)} ${rsi > 70 ? '✅' : '❌'} | stretch: ${stretch.toFixed(2)}x ${stretch > 1.0 ? '✅' : '❌'} | atHigh: ${atHigh ? '✅' : '❌'} → ${cnt}/3`);
                    }
                    const passed = !accuracyOn || checkAccuracy('up');
                    if (accuracyOn && !passed) {
                        log(`📊 ${upCount} UP — accuracy FAILED, waiting...`);
                        consecutiveUpRef.current = 0;
                        consecutiveDownRef.current = 0;
                        return;
                    }
                    const accTag = accuracyOn ? ' ✅ ACCURATE' : '';
                    log(`📊 ${upCount} consecutive UP (${prevPrice}→${price}) — GO!${accTag}`);
                    setTickProgress({ dir: 'GO!', count: target, target });
                    const resolve = tickDirResolveRef.current;
                    tickDirResolveRef.current = null;
                    tickDirActiveRef.current = false;
                    consecutiveUpRef.current = 0;
                    consecutiveDownRef.current = 0;
                    resolve();
                    return;
                }

                if (downCount >= target) {
                    const accuracyOn = accuracyRef.current;
                    if (accuracyOn) {
                        const prices = recentPricesRef.current;
                        const rsi = calcRSI(prices);
                        const stretch = calcEMAStretch(prices);
                        const lastP = prices[prices.length - 1];
                        const mn = Math.min(...prices.slice(-10));
                        const mx = Math.max(...prices.slice(-10));
                        const rng = mx - mn;
                        const atHigh = rng > 0 && (lastP - mn) / rng > 0.85;
                        const atLow = rng > 0 && (mx - lastP) / rng > 0.85;
                        let cnt = 0;
                        if (rsi < 30) cnt++; else if (rsi > 70) cnt++;
                        if (stretch > 1.0) cnt++;
                        if (atLow) cnt++;
                        log(`  📐 RSI: ${rsi.toFixed(1)} ${rsi < 30 ? '✅' : '❌'} | stretch: ${stretch.toFixed(2)}x ${stretch > 1.0 ? '✅' : '❌'} | atLow: ${atLow ? '✅' : '❌'} → ${cnt}/3`);
                    }
                    const passed = !accuracyOn || checkAccuracy('down');
                    if (accuracyOn && !passed) {
                        log(`📊 ${downCount} DOWN — accuracy FAILED, waiting...`);
                        consecutiveUpRef.current = 0;
                        consecutiveDownRef.current = 0;
                        return;
                    }
                    const accTag = accuracyOn ? ' ✅ ACCURATE' : '';
                    log(`📊 ${downCount} consecutive DOWN (${prevPrice}→${price}) — GO!${accTag}`);
                    setTickProgress({ dir: 'GO!', count: target, target });
                    const resolve = tickDirResolveRef.current;
                    tickDirResolveRef.current = null;
                    tickDirActiveRef.current = false;
                    consecutiveUpRef.current = 0;
                    consecutiveDownRef.current = 0;
                    resolve();
                    return;
                }

                if (upCount > 0) {
                    setTickProgress({ dir: 'UP', count: upCount, target });
                    log(`  ↑ UP ${upCount}/${target} (${prevPrice}→${price})`);
                } else if (downCount > 0) {
                    setTickProgress({ dir: 'DOWN', count: downCount, target });
                    log(`  ↓ DOWN ${downCount}/${target} (${prevPrice}→${price})`);
                }
            } catch {}
        });
        return unsub;
    }, [running, log]);

    // Wait for N ticks in same direction — returns true if matched, false if cancelled
    const waitForTickDirection = useCallback((target: number, gen: number): Promise<boolean> => {
        return new Promise((resolve) => {
            if (target <= 0) { resolve(true); return; }
            tickDirTargetRef.current = target;
            tickDirActiveRef.current = true;
            consecutiveUpRef.current = 0;
            consecutiveDownRef.current = 0;
            lastTickPriceRef.current = null;
            // Store resolve so stop() can call it to unblock
            tickDirResolveRef.current = () => {
                if (genRef.current === gen) resolve(true);
                else resolve(false);
            };
        });
    }, []);

    // Wait for N ticks (for Rise/Fall delay)
    const waitForTicks = useCallback((ticks: number, gen: number): Promise<void> => {
        return new Promise((resolve) => {
            if (ticks <= 0) { resolve(); return; }
            pendingDelaysRef.current.push({ ticksNeeded: ticks, resolve, gen });
        });
    }, []);

    const getStake = useCallback((strategy: MultiKillerStrategy): number => {
        return parseFloat(stakesRef.current[strategy] ?? '10') || 10;
    }, []);

    // Buy a single contract
    const buyOne = useCallback((strategy: MultiKillerStrategy, stakeNum: number, roundId: number): Promise<{ cid: string; strategy: MultiKillerStrategy } | null> => {
        return new Promise((resolve) => {
            const ws = window._newSystemWS;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                log('❌ WS not open');
                resolve(null);
                return;
            }

            const reqId = Date.now() * 1000 + (++_buySeq);
            const ct = CONTRACT_TYPE[strategy];
            const dur = DURATION[strategy];
            const needBarrier = NEEDS_BARRIER[strategy];
            const rawBarrier = barriersRef.current[strategy] ?? '5';
            const barrier = needBarrier ? String(parseInt(rawBarrier) || 5) : undefined;

            const params: Record<string, any> = {
                amount: stakeNum,
                basis: 'stake',
                contract_type: ct,
                currency: 'USD',
                duration: dur,
                duration_unit: 't',
                symbol: market,
            };
            if (barrier !== undefined) params.barrier = barrier;

            const toSend: any = {
                buy: '1',
                price: stakeNum,
                parameters: { ...params, underlying_symbol: params.symbol },
                req_id: reqId,
            };
            delete toSend.parameters.symbol;

            log(`📤 ${LABELS[strategy]} ${ct}${barrier !== undefined ? ' B' + barrier : ''} ${dur}t $${stakeNum}`);

            const cleanup = () => {
                window.removeEventListener('newSystemMessage', handler);
                const idx = buyListenersRef.current.indexOf(cleanup);
                if (idx !== -1) buyListenersRef.current.splice(idx, 1);
            };

            const handler = (event: any) => {
                try {
                    const data = JSON.parse(event.detail?.data ?? event.data);
                    if (data.req_id !== reqId) return;
                    cleanup();

                    if (data.error) {
                        log(`❌ ${LABELS[strategy]}: ${data.error.message || 'error'}`);
                        resolve(null);
                        return;
                    }

                    const cid = String(data.buy?.contract_id ?? data.contract_id);
                    if (cid && cid !== 'undefined') {
                        ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));

                        try {
                            transactions.onBotContractEvent({
                                contract_id: Number(cid),
                                transaction_ids: { buy: data.buy?.transaction_id ?? Number(cid) },
                                buy_price: stakeNum,
                                currency: 'USD',
                                contract_type: ct,
                                underlying: market,
                                display_name: market,
                                date_start: Math.floor(Date.now() / 1000),
                                status: 'open',
                                entry_tick: data.buy?.entry_tick,
                                entry_tick_time: data.buy?.entry_tick_time,
                            } as any);
                        } catch {}

                        log(`✅ ${LABELS[strategy]} bought (#${cid})`);
                        resolve({ cid, strategy });
                    } else {
                        log(`⚠️ ${LABELS[strategy]}: no contract_id`);
                        resolve(null);
                    }
                } catch {}
            };

            buyListenersRef.current.push(cleanup);
            window.addEventListener('newSystemMessage', handler);
            ws.send(JSON.stringify(toSend));

            setTimeout(() => {
                cleanup();
                log(`❌ ${LABELS[strategy]}: timeout`);
                resolve(null);
            }, 15000);
        });
    }, [market, log, transactions]);

    // Settlement listener — only counts contracts from current round
    useEffect(() => {
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'proposal_open_contract') return;
                const poc = data.proposal_open_contract;
                if (!poc?.is_sold) return;
                const cid = String(poc.contract_id);
                const profit = parseFloat(poc.profit) || 0;

                const currentRound = roundIdRef.current;
                const idx = tradesRef.current.findIndex(t => t.contractId === cid && t.roundId === currentRound);
                if (idx === -1) return;
                const t = tradesRef.current[idx];

                const icon = profit >= 0 ? '✅' : '❌';
                log(`${icon} ${LABELS[t.strategy]}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${t.stake}$ bet)`);
                tradesRef.current.splice(idx, 1);
                settledCountRef.current++;
                setSettleProgress({ done: settledCountRef.current, total: expectedSettlementsRef.current });

                try {
                    transactions.onBotContractEvent({
                        ...poc,
                        contract_id: cid,
                        transaction_ids: { buy: poc.transaction_ids?.buy ?? cid },
                        buy_price: t.stake,
                        sell_price: t.stake + profit,
                        display_name: poc.display_name ?? market,
                        status: 'sold',
                        profit,
                        is_sold: true,
                        is_completed: true,
                    } as any);
                } catch {}

                log(`  (${settledCountRef.current}/${expectedSettlementsRef.current} settled)`);

                if (buyPhaseDoneRef.current && settledCountRef.current >= expectedSettlementsRef.current) {
                    if (roundCompleteResolveRef.current) {
                        roundCompleteResolveRef.current();
                        roundCompleteResolveRef.current = null;
                    }
                }
            } catch {}
        });
        return unsub;
    }, [log, transactions, market]);

    const runRoundRef = useRef<() => Promise<void>>();

    // Execute a round — tick direction → buy phase → settlement phase
    const runRound = useCallback(async () => {
        if (!runningRef.current) return;
        const gen = genRef.current;
        const sel = selectedRef.current;
        if (sel.length === 0) {
            log('⚠️ No strategies selected');
            runningRef.current = false;
            setRunning(false);
            return;
        }

        // Increment round ID — old contracts from previous rounds are ignored
        roundIdRef.current++;
        const myRound = roundIdRef.current;

        const tdTarget = showTickDir ? (parseInt(tickDirection) || 0) : 0;

        // ── TICK DIRECTION PHASE ──
        if (tdTarget > 0) {
            log(`📊 Waiting for ${tdTarget} ticks in same direction...`);
            const ok = await waitForTickDirection(tdTarget, gen);
            if (genRef.current !== gen || !runningRef.current) return;
            if (!ok) return;
        }

        const totalCost = sel.reduce((sum, s) => sum + getStake(s), 0);
        log(`🚀 Round #${myRound}: ${sel.length} contracts = $${totalCost.toFixed(2)} total`);

        // ── BUY PHASE ──
        buyPhaseDoneRef.current = false;
        expectedSettlementsRef.current = 0;
        settledCountRef.current = 0;
        buyListenersRef.current.forEach(c => c());
        buyListenersRef.current = [];

        setRunPhase('buying');
        setBuyProgress({ done: 0, total: sel.length });
        setSettleProgress({ done: 0, total: 0 });

        const promises = sel.map(async (s, idx) => {
            const delayTicks = HAS_DELAY[s] ? (delaysRef.current[s] ?? 0) : 0;
            if (delayTicks > 0) {
                log(`⏱ ${LABELS[s]} waiting ${delayTicks} tick${delayTicks > 1 ? 's' : ''}...`);
                await waitForTicks(delayTicks, gen);
                if (genRef.current !== gen) return null;
                log(`⏱ ${LABELS[s]} tick delay done — buying`);
            }
            const result = await buyOne(s, getStake(s), myRound);
            setBuyProgress(prev => ({ ...prev, done: prev.done + 1 }));
            return result;
        });

        const results = await Promise.all(promises);

        if (genRef.current !== gen) return;

        // Register bought contracts — tagged with roundId
        const bought: TradeEntry[] = [];
        results.forEach(r => {
            if (r) bought.push({ contractId: r.cid, strategy: r.strategy, stake: getStake(r.strategy), roundId: myRound });
        });

        if (bought.length === 0) {
            log('❌ All buys failed');
            runningRef.current = false;
            setRunning(false);
            return;
        }

        tradesRef.current.push(...bought);
        expectedSettlementsRef.current = bought.length;
        buyPhaseDoneRef.current = true;
        setRunPhase('settling');
        setSettleProgress({ done: 0, total: bought.length });
        log(`✅ ${bought.length} open — waiting for all settlements`);

        // ── SETTLEMENT PHASE ──
        if (settledCountRef.current >= expectedSettlementsRef.current) {
            log(`🔄 Round #${myRound} complete — next round in 5s`);
            await new Promise<void>(r => {
                const g = genRef.current;
                setTimeout(() => {
                    if (runningRef.current && genRef.current === g) r();
                    else r();
                }, 5000);
            });
            if (genRef.current === gen && runningRef.current) {
                runRoundRef.current?.();
            }
            return;
        }

        await new Promise<void>((resolve) => {
            roundCompleteResolveRef.current = resolve;
        });

        if (genRef.current !== gen) return;

        log(`🔄 Round #${myRound} complete — next round in 5s`);
        await new Promise<void>(r => {
            const g = genRef.current;
            setTimeout(() => {
                if (runningRef.current && genRef.current === g) r();
                else r();
            }, 5000);
        });

        if (genRef.current === gen && runningRef.current) {
            runRoundRef.current?.();
        }
    }, [buyOne, log, waitForTicks, waitForTickDirection, getStake, showTickDir, tickDirection]);

    runRoundRef.current = runRound;

    const start = useCallback(() => {
        if (running || selected.length === 0) return;
        setRunning(true);
        setRunPhase('waiting');
        setBuyProgress({ done: 0, total: 0 });
        setSettleProgress({ done: 0, total: 0 });
        setTickProgress({ dir: '⏳', count: 0, target: 0 });
        setLogs([]);
        runningRef.current = true;
        genRef.current++;
        tradesRef.current = [];
        pendingDelaysRef.current = [];
        buyPhaseDoneRef.current = false;
        expectedSettlementsRef.current = 0;
        settledCountRef.current = 0;
        tickDirResolveRef.current = null;
        tickDirActiveRef.current = false;
        consecutiveUpRef.current = 0;
        consecutiveDownRef.current = 0;
        lastTickPriceRef.current = null;
        log('▶️ Started');
        runRoundRef.current?.();
    }, [running, selected, log]);

    const stop = useCallback(() => {
        genRef.current++;
        runningRef.current = false;
        setRunning(false);
        tradesRef.current = [];
        buyPhaseDoneRef.current = false;
        tickDirActiveRef.current = false;
        // Unblock all waiting promises
        buyListenersRef.current.forEach(c => c());
        buyListenersRef.current = [];
        pendingDelaysRef.current.forEach(p => p.resolve());
        pendingDelaysRef.current = [];
        if (tickDirResolveRef.current) {
            tickDirResolveRef.current();
            tickDirResolveRef.current = null;
        }
        if (tickDirResolveRef.current) {
            tickDirResolveRef.current();
            tickDirResolveRef.current = null;
        }
        if (roundCompleteResolveRef.current) {
            roundCompleteResolveRef.current();
            roundCompleteResolveRef.current = null;
        }
        setRunPhase('idle');
        setBuyProgress({ done: 0, total: 0 });
        setSettleProgress({ done: 0, total: 0 });
        setTickProgress({ dir: '...', count: 0, target: 0 });
        log('⏹ Stopped');
    }, [log]);

    const analyzeVolatilities = useCallback(async () => {
        const ws = window._newSystemWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setAnalyzeResult('❌ WebSocket not connected');
            return;
        }

        setAnalyzing(true);
        setAnalyzeResult(null);
        setLogs(p => ['📊 Analyzing volatilities...', ...p].slice(0, 80));

        const VOL_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
        const hasDowns = selected.includes('downs');
        const hasUps = selected.includes('ups');
        const needBB = hasDowns || hasUps;

        const fetchTicks = async (sym: string): Promise<number[]> => {
            try {
                const data = await sendViaNewSystemWithPromise({ ticks_history: sym, style: 'ticks', count: 200, end: 'latest' });
                return (data.history?.prices || data.prices || []).map(Number);
            } catch { return []; }
        };

        const fetchCandles = async (sym: string): Promise<Array<{ open: number; high: number; low: number; close: number }>> => {
            try {
                const data = await sendViaNewSystemWithPromise({ ticks_history: sym, style: 'candles', granularity: 60, count: 30, end: 'latest' });
                return (data.candles || []).map((c: any) => ({ open: +c.open, high: +c.high, low: +c.low, close: +c.close }));
            } catch { return []; }
        };

        const allData: Array<{ sym: string; prices: number[]; candles: Array<{ open: number; high: number; low: number; close: number }> }> = [];
        for (const sym of VOL_SYMBOLS) {
            const prices = await fetchTicks(sym);
            const candles = await fetchCandles(sym);
            allData.push({ sym, prices, candles });
            await new Promise(r => setTimeout(r, 300));
        }

        const calcBB = (candles: Array<{ close: number }>): { upper: number; middle: number; lower: number } | null => {
            if (candles.length < 20) return null;
            const closes = candles.slice(-20).map(c => c.close);
            const sma = closes.reduce((a, b) => a + b, 0) / 20;
            const variance = closes.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / 20;
            return { upper: sma + 2 * Math.sqrt(variance), middle: sma, lower: sma - 2 * Math.sqrt(variance) };
        };

        const results: Array<{
            sym: string;
            label: string;
            maxStreak: number;
            over4Pct: number;
            upCount: number;
            downCount: number;
            avgMove: number;
            bbPosition: string;
            tickScore: number;
            bbScore: number;
            totalScore: number;
            accuracySignals: number;
            totalStreaks: number;
        }> = [];

        for (const { sym, prices, candles } of allData) {
            let maxStreak = 0;
            let currentStreak = 0;
            let over4Count = 0;
            let streakDir = 0;
            let upCount = 0;
            let downCount = 0;
            let totalMovement = 0;
            let realMoves = 0;

            for (let i = 1; i < prices.length; i++) {
                const diff = prices[i] - prices[i - 1];
                if (diff === 0) continue;
                const dir = diff > 0 ? 1 : -1;
                if (dir > 0) upCount++; else downCount++;
                totalMovement += Math.abs(diff);
                realMoves++;
                if (dir === streakDir) {
                    currentStreak++;
                } else {
                    if (currentStreak > maxStreak) maxStreak = currentStreak;
                    if (currentStreak > 4) over4Count++;
                    currentStreak = 1;
                    streakDir = dir;
                }
            }
            if (currentStreak > maxStreak) maxStreak = currentStreak;
            if (currentStreak > 4) over4Count++;

            const over4Pct = realMoves > 0 ? Math.round((over4Count / realMoves) * 100) : 100;
            const avgMove = realMoves > 0 ? totalMovement / realMoves : 0;
            const tickScore = Math.max(0, 100 - over4Pct * 3);

            let bbPosition = 'N/A';
            let bbScore = 50;
            const bb = calcBB(candles);
            if (bb && candles.length >= 2) {
                const last2 = candles.slice(-2);
                const bbRange = bb.upper - bb.lower;
                if (bbRange > 0) {
                    const touchDist = 0.05;
                    const nearDist = 0.15;

                    const touchedUpper = last2.some(c => c.high >= bb.upper);
                    const almostUpper = last2.some(c => (c.high - bb.lower) / bbRange >= (1 - touchDist));
                    const nearUpper = last2.some(c => (c.high - bb.lower) / bbRange >= (1 - nearDist));
                    const touchedLower = last2.some(c => c.low <= bb.lower);
                    const almostLower = last2.some(c => (c.low - bb.lower) / bbRange <= touchDist);
                    const nearLower = last2.some(c => (c.low - bb.lower) / bbRange <= nearDist);

                    if (touchedUpper) bbPosition = '🔴 UPPER';
                    else if (almostUpper) bbPosition = '🟠 near upper';
                    else if (nearUpper) bbPosition = '🟡 mid-upper';
                    else if (touchedLower) bbPosition = '🟢 LOWER';
                    else if (almostLower) bbPosition = '🟢 near lower';
                    else if (nearLower) bbPosition = '🟡 mid-lower';
                    else bbPosition = '⚪ middle';

                    if (hasDowns) {
                        if (touchedUpper) bbScore = 100;
                        else if (almostUpper) bbScore = 90;
                        else if (nearUpper) bbScore = 70;
                        else bbScore = 20;
                    } else if (hasUps) {
                        if (touchedLower) bbScore = 100;
                        else if (almostLower) bbScore = 90;
                        else if (nearLower) bbScore = 70;
                        else bbScore = 20;
                    } else {
                        bbScore = 50;
                    }
                }
            }

            let accuracySignals = 0;
            let totalStreaks = 0;
            {
                let sDir = 0;
                let sLen = 0;
                for (let i = 1; i < prices.length; i++) {
                    const diff = prices[i] - prices[i - 1];
                    if (diff === 0) continue;
                    const d = diff > 0 ? 1 : -1;
                    if (d === sDir) { sLen++; }
                    else {
                        if (sLen >= 3) {
                            totalStreaks++;
                            const slice = prices.slice(Math.max(0, i - 14), i + 1);
                            if (slice.length >= 5) {
                                let g = 0, l = 0;
                                for (let j = 1; j < slice.length; j++) {
                                    const dd = slice[j] - slice[j - 1];
                                    if (dd > 0) g += dd; else l += Math.abs(dd);
                                }
                                const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
                                let ema = slice[0];
                                const k = 2 / 10;
                                for (let j = 1; j < slice.length; j++) ema = slice[j] * k + ema * (1 - k);
                                const dist = Math.abs(slice[slice.length - 1] - ema);
                                let avgM = 0;
                                for (let j = 1; j < slice.length; j++) avgM += Math.abs(slice[j] - slice[j - 1]);
                                avgM /= (slice.length - 1);
                                const stretch = avgM > 0 ? dist / avgM : 0;
                                const last = slice[slice.length - 1];
                                const mn = Math.min(...slice);
                                const mx = Math.max(...slice);
                                const rng = mx - mn;
                                const atExtreme = rng > 0 && (sDir > 0 ? (last - mn) / rng > 0.85 : (mx - last) / rng > 0.85);
                                const rsiOK = sDir > 0 ? rsi > 70 : rsi < 30;
                                let confirmCount = 0;
                                if (rsiOK) confirmCount++;
                                if (stretch > 1.0) confirmCount++;
                                if (atExtreme) confirmCount++;
                                if (confirmCount >= 2) accuracySignals++;
                            }
                        }
                        sLen = 1;
                        sDir = d;
                    }
                }
            }

            // Score: BB factor + indicator factor (when accuracy ON)
            const bbRatio = needBB ? bbScore / 100 : 1;
            const indRatio = totalStreaks > 0 ? accuracySignals / totalStreaks : 0;
            let baseScore = tickScore * 0.4;
            if (needBB) baseScore += bbScore * 0.3;
            if (accuracy) baseScore += Math.round(indRatio * 100) * 0.3;
            const totalScore = Math.round(baseScore);
            const bbMiddle = bbPosition === '⚪ middle' || bbPosition === 'N/A';

            // Strict BB filter: middle/mid-upper/mid-lower never allowed for directional trading
            let bbPassesFilter = true;
            if (needBB) {
                const isUpper = bbPosition === '🔴 UPPER' || bbPosition === '🟠 near upper';
                const isLower = bbPosition === '🟢 LOWER' || bbPosition === '🟢 near lower';
                const isMiddle = bbPosition === '⚪ middle' || bbPosition === '🟡 mid-upper' || bbPosition === '🟡 mid-lower' || bbPosition === 'N/A';
                if (isMiddle) bbPassesFilter = false;
                if (hasDowns && !isUpper) bbPassesFilter = false;
                if (hasUps && !isLower) bbPassesFilter = false;
            }

            const adjustedScore = !bbPassesFilter ? 0 : totalScore;

            results.push({ sym, label: `Vol ${sym.replace('R_', '')}`, maxStreak, over4Pct, upCount, downCount, avgMove, bbPosition, tickScore, bbScore, totalScore: adjustedScore, accuracySignals, totalStreaks });
        }

        results.sort((a, b) => b.totalScore - a.totalScore);

        let mode = 'Tick direction';
        if (hasDowns) mode = 'Only Downs → looking for upper BB';
        else if (hasUps) mode = 'Only Ups → looking for lower BB';
        if (accuracy) mode += ' + Accuracy (30% weight)';

        let msg = `📊 ANALYSIS — ${mode}\n`;
        const candleCounts = allData.map(d => `${d.sym.replace('R_', '')}:${d.candles.length}`).join(' ');
        msg += `Candles: ${candleCounts}\n`;
        msg += `Indicators: RSI(3) >70/<30 + EMA stretch >1x + 85% range extreme (2-of-3 needed)\n\n`;
        results.forEach((r, i) => {
            const rank = i === 0 ? '🏆' : i === 1 ? '✅' : '  ';
            const bbOk = !needBB || r.totalScore > 0;
            const bbTag = bbOk ? '' : ' ❌';
            msg += `${rank} ${r.label}: streaks>4: ${r.over4Pct}% | avg ${r.avgMove.toFixed(2)} | BB: ${r.bbPosition}${bbTag} | ind: ${r.accuracySignals}/${r.totalStreaks}`;
            if (needBB) msg += ` [${r.totalScore}]`;
            msg += '\n';
        });

        const best = results[0];
        if (needBB && best.totalScore === 0) {
            const required = hasDowns ? 'UPPER' : hasUps ? 'LOWER' : 'any';
            msg += `\n⚠️ NO VOLATILITY at ${required} BB — all filtered out\n`;
            msg += `Available: ${results.map(r => `${r.label}(${r.bbPosition})`).join(', ')}\n`;
            msg += `Try again later when candles reach the ${required} band`;
        } else {
            msg += `\n💡 BEST: ${best.label} (score ${best.totalScore})\n`;
            if (needBB) msg += `BB position: ${best.bbPosition}\n`;
            msg += `Indicator signals: ${best.accuracySignals}/${best.totalStreaks} streaks confirmed\n`;
            msg += `Tick streaks >4: ${best.over4Pct}%`;
        }

        setAnalyzeResult(msg);
        if (best.totalScore > 0) {
            setMarket(best.sym);
            setLogs(p => [`📊 Best: ${best.label} — auto-selected`, ...p].slice(0, 80));
        } else {
            // No BB match — switch ALL contracts that need that band to opposite
            const upperVol = results.find(r => r.bbPosition.includes('UPPER') || r.bbPosition.includes('upper'));
            const lowerVol = results.find(r => r.bbPosition.includes('LOWER') || r.bbPosition.includes('lower'));
            const hasRise = selected.includes('rise');
            const hasFall = selected.includes('fall');
            const hasUps = selected.includes('ups');
            const hasDowns = selected.includes('downs');

            // Contracts needing upper BB: rise, downs
            const needsUpper = hasRise || hasDowns;
            // Contracts needing lower BB: fall, ups
            const needsLower = hasFall || hasUps;

            if (needsUpper && upperVol) {
                // All upper-needing contracts found upper BB — use it
                setMarket(upperVol.sym);
                setLogs(p => [`📊 ${upperVol.label} (${upperVol.bbPosition}) — auto-selected`, ...p].slice(0, 80));
            } else if (needsUpper && lowerVol) {
                // No upper BB — flip ALL to opposite
                const newSelected = selected.map(s => {
                    if (s === 'rise') return 'fall';
                    if (s === 'fall') return 'rise';
                    if (s === 'ups') return 'downs';
                    if (s === 'downs') return 'ups';
                    return s;
                });
                setSelected(newSelected);
                if (hasDowns) setTickDirMode('ups');
                if (hasUps) setTickDirMode('downs');
                setMarket(lowerVol.sym);
                const switched = selected.filter(s => s === 'rise' || s === 'downs').map(s => s === 'rise' ? 'Fall' : 'Only Ups').join(', ');
                setLogs(p => [`🔄 No upper BB → switched ${switched} → ${lowerVol.label} (${lowerVol.bbPosition})`, ...p].slice(0, 80));
                msg += `\n\n🔄 AUTO-SWITCH: No upper BB → ${switched} → ${lowerVol.label}`;
                setAnalyzeResult(msg);
            } else if (needsLower && lowerVol) {
                setMarket(lowerVol.sym);
                setLogs(p => [`📊 ${lowerVol.label} (${lowerVol.bbPosition}) — auto-selected`, ...p].slice(0, 80));
            } else if (needsLower && upperVol) {
                const newSelected = selected.map(s => {
                    if (s === 'rise') return 'fall';
                    if (s === 'fall') return 'rise';
                    if (s === 'ups') return 'downs';
                    if (s === 'downs') return 'ups';
                    return s;
                });
                setSelected(newSelected);
                if (hasUps) setTickDirMode('downs');
                if (hasDowns) setTickDirMode('ups');
                setMarket(upperVol.sym);
                const switched = selected.filter(s => s === 'fall' || s === 'ups').map(s => s === 'fall' ? 'Rise' : 'Only Downs').join(', ');
                setLogs(p => [`🔄 No lower BB → switched ${switched} → ${upperVol.label} (${upperVol.bbPosition})`, ...p].slice(0, 80));
                msg += `\n\n🔄 AUTO-SWITCH: No lower BB → ${switched} → ${upperVol.label}`;
                setAnalyzeResult(msg);
            } else {
                setLogs(p => [`⚠️ No volatility meets BB requirement for any direction`, ...p].slice(0, 80));
            }
        }
        setAnalyzing(false);
    }, [selected]);

    const playClick = useCallback(() => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.06);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.08);
        } catch {}
    }, []);

    const toggle = (s: MultiKillerStrategy) => {
        if (running) return;
        playClick();
        setSelected(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
        if (!stakes[s]) setStakes(p => ({ ...p, [s]: '10' }));
    };

    return (
        <div className='mw-killer multi-killer-theme'>
            <div className='mw-field'>
                <label className='mw-label'>Market</label>
                <div className='mw-select-wrap'>
                    <select className='mw-input' value={market} onChange={e => setMarket(e.target.value)}>
                        {ALL_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className='mw-select-arrow'></span>
                </div>
            </div>

            {showTickDir && (
                <button className={`mw-btn mw-btn--analyze ${analyzing ? 'mw-btn--analyzing' : ''}`}
                    disabled={analyzing || running}
                    onClick={analyzeVolatilities}>
                    {analyzing ? '⏳ Analyzing...' : '📊 Analyze Volatility'}
                </button>
            )}

            <div className='mw-killer__types'>
                <label className='mw-label'>Strategies</label>
                <div className='mw-types-row'>
                    {(Object.keys(LABELS) as MultiKillerStrategy[]).map(s => (
                        <label key={s} className={`mw-type-chip ${selected.includes(s) ? 'mw-type-chip--active' : ''}`}>
                            <input type='checkbox' checked={selected.includes(s)}
                                onChange={() => toggle(s)} disabled={running} />
                            <span className='mw-type-chip__label'>{LABELS[s]}</span>
                            {HAS_DELAY[s] && selected.includes(s) && (
                                <div className='mw-select-wrap mw-select-wrap--sm'>
                                    <select
                                        className='mw-input mw-type-delay'
                                        value={delays[s] ?? 0}
                                        onChange={e => setDelays(p => ({ ...p, [s]: Number(e.target.value) }))}
                                        disabled={running}
                                        onClick={e => e.stopPropagation()}
                                    >
                                        <option value={0}>0t</option>
                                        <option value={1}>1t</option>
                                        <option value={2}>2t</option>
                                    </select>
                                    <span className='mw-select-arrow mw-select-arrow--sm'></span>
                                </div>
                            )}
                        </label>
                    ))}
                </div>
            </div>

            {showTickDir && (
                <div className='mw-killer__fields'>
                    <div className='mw-field mw-field--grow'>
                        <label className='mw-label'>Wait Ticks</label>
                        <input className='mw-input' type='number' min='1' max='20' step='1'
                            value={tickDirection}
                            onChange={e => setTickDirection(e.target.value)} />
                        <span className='mw-hint'>0 = off</span>
                    </div>
                    <div className='mw-field mw-field--grow'>
                        <label className='mw-label'>Direction</label>
                        <div className='mw-select-wrap'>
                            <select className='mw-input' value={tickDirMode}
                                onChange={e => setTickDirMode(e.target.value as any)}>
                                <option value='any'>Any</option>
                                <option value='ups'>Ups Only</option>
                                <option value='downs'>Downs Only</option>
                            </select>
                            <span className='mw-select-arrow'></span>
                        </div>
                    </div>
                </div>
            )}

            {hasDirectional && showTickDir && (
                <div className='mw-accuracy-row'>
                    <button
                        className={`mw-accuracy-btn ${accuracy ? 'mw-accuracy-btn--on' : ''}`}
                        onClick={() => setAccuracy(a => !a)}
                        disabled={running}
                    >
                        <span className='mw-accuracy-icon'>{accuracy ? '🎯' : '🎯'}</span>
                        <span>Accuracy</span>
                        <span className={`mw-accuracy-toggle ${accuracy ? 'mw-accuracy-toggle--on' : ''}`}>
                            <span className='mw-accuracy-knob' />
                        </span>
                    </button>
                    <span className='mw-accuracy-hint'>
                        {accuracy ? '2-of-3 indicators (RSI+EMA+Extreme)' : 'Off — streak only'}
                    </span>
                </div>
            )}

            {selected.length > 0 && (
                <div className='mw-killer__fields'>
                    {selected.map(s => (
                        <div key={s} className='mw-field mw-field--grow'>
                            <label className='mw-label'>{LABELS[s]} Stake</label>
                            <input className='mw-input' type='number' min='0.35' step='0.01'
                                value={stakes[s] ?? '10'}
                                onChange={e => setStakes(p => ({ ...p, [s]: e.target.value }))} />
                        </div>
                    ))}
                </div>
            )}

            {selected.some(s => NEEDS_BARRIER[s]) && (
                <div className='mw-killer__fields'>
                    {selected.filter(s => NEEDS_BARRIER[s]).map(s => (
                        <div key={s} className='mw-field mw-field--grow'>
                            <label className='mw-label'>{LABELS[s]} Barrier</label>
                            <input className='mw-input' type='number' min='0' max='9' step='1'
                                value={barriers[s] ?? '5'}
                                onChange={e => setBarriers(p => ({ ...p, [s]: e.target.value }))} />
                        </div>
                    ))}
                </div>
            )}

            <div className='mw-killer__actions'>
                {running ? (
                    <button className='mw-btn mw-btn--stop' onClick={stop}>
                        <span className='mw-btn__text'>
                            {runPhase === 'waiting' && tickProgress.target > 0 && tickProgress.dir !== 'GO!'
                                ? `${tickProgress.dir} ${tickProgress.count}/${tickProgress.target}`
                                : runPhase === 'waiting' && '⏳ Waiting...'}
                            {runPhase === 'buying' && `📤 ${buyProgress.done}/${buyProgress.total}`}
                            {runPhase === 'settling' && `⏳ ${settleProgress.done}/${settleProgress.total}`}
                        </span>
                        {(buyProgress.total > 0 || settleProgress.total > 0) && (
                            <span className='mw-btn__bar'>
                                <span className='mw-btn__fill'
                                    style={{
                                        width: runPhase === 'buying'
                                            ? `${buyProgress.total > 0 ? (buyProgress.done / buyProgress.total) * 100 : 0}%`
                                            : `${settleProgress.total > 0 ? (settleProgress.done / settleProgress.total) * 100 : 0}%`,
                                        background: runPhase === 'buying'
                                            ? 'linear-gradient(90deg, #f97316, #fb923c)'
                                            : 'linear-gradient(90deg, #22c55e, #4ade80)',
                                    }} />
                            </span>
                        )}
                    </button>
                ) : (
                    <button className='mw-btn mw-btn--run' disabled={!selected.length} onClick={start}>Run</button>
                )}
            </div>

            {analyzeResult && (
                <div className='mw-analyze-result'>
                    <div className='mw-analyze-head'>
                        <span>Analysis Result</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button className='mw-copy-btn' onClick={() => {
                                navigator.clipboard.writeText(analyzeResult);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            }}>{copied ? '✓ Copied' : '📋 Copy'}</button>
                            <button className='mw-copy-btn' onClick={() => setAnalyzeResult(null)}>✕</button>
                        </div>
                    </div>
                    <pre>{analyzeResult}</pre>
                </div>
            )}

            <div className='mw-killer__logs'>
                <div className='mw-killer__logs-head'>Log</div>
                <div className='mw-killer__log-list'>
                    {logs.length === 0
                        ? <div className='mw-killer__log-empty'>Select strategies → Run</div>
                        : logs.map((l, i) => <div key={i} className='mw-killer__log-line'>{l}</div>)
                    }
                </div>
            </div>
        </div>
    );
};
