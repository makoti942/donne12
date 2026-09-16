import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, openMakotiWS, MakotiWS } from './makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import { MwSelect } from './mw-select';

type ContractSide = 'DIGITOVER' | 'DIGITUNDER';

interface LogEntry { time: string; msg: string; type: 'win' | 'loss' | 'info' | 'trade' | 'pattern'; }
interface SymProgress { symbol: string; ticks: number; lastDigits: number[]; status: string; }

const DEFAULT_CFG = {
    stake: '0.35', martingale: '2',
    primarySide: 'DIGITUNDER' as ContractSide, primaryDigit: '4',
    recoverySide: 'DIGITOVER' as ContractSide, recoveryDigit: '5',
};
const LS_KEY = 'mw_uum_config';

function loadCfg() { try { const r = localStorage.getItem(LS_KEY); return r ? { ...DEFAULT_CFG, ...JSON.parse(r) } : DEFAULT_CFG; } catch { return DEFAULT_CFG; } }
function saveCfg(c: typeof DEFAULT_CFG) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {} }
function ts() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }

// Under pattern: d1<4, d2<4, d3>5, d4<4  |  Over pattern: d1>5, d2>5, d3<4, d4>5
function checkPattern(d: number[], side: ContractSide): boolean {
    if (d.length < 4) return false;
    const [a, b, c, e] = d.slice(-4);
    return side === 'DIGITUNDER' ? (a < 4 && b < 4 && c > 5 && e < 4) : (a > 5 && b > 5 && c < 4 && e > 5);
}

// Hot digit filter: the GROUP must dominate in last 15 ticks
// UNDER → digits 0-4 must appear MORE than 5-9
// OVER  → digits 5-9 must appear MORE than 0-4
function hotDigitDominates(ticks: number[], side: ContractSide): boolean {
    const last25 = ticks.slice(-25);
    // Need at least 4 ticks for dominance to be meaningful
    if (last25.length < 4) return false;
    let low = 0;  // 0-4
    let high = 0; // 5-9
    last25.forEach(d => {
        if (d <= 4) low++;
        else high++;
    });
    return side === 'DIGITUNDER' ? low > high : high > low;
}

export const UnderUnderMarket: React.FC = () => {
    const { transactions } = useStore();
    const cfg = loadCfg();
    const [stake, setStake] = useState(cfg.stake);
    const [martingale, setMartingale] = useState(cfg.martingale);
    const [pSide, setPSide] = useState<ContractSide>(cfg.primarySide);
    const [pDigit, setPDigit] = useState(cfg.primaryDigit);
    const [rSide, setRSide] = useState<ContractSide>(cfg.recoverySide);
    const [rDigit, setRDigit] = useState(cfg.recoveryDigit);
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [pnl, setPnl] = useState(0);
    const [trades, setTrades] = useState(0);
    const [conn, setConn] = useState(false);
    const [symProg, setSymProg] = useState<Record<string, SymProgress>>({});

    const wsRef = useRef<MakotiWS | null>(null);
    const runRef = useRef(false);
    const lockRef = useRef(false);
    const recovRef = useRef(false);
    const pnlRef = useRef(0);
    const cntRef = useRef(0);
    const bufRef = useRef<Record<string, number[]>>({});
    const cmapRef = useRef<Map<string, { sym: string; amt: number; phase: 'p' | 'r' }>>(new Map());
    const cfgRef = useRef({ s: parseFloat(cfg.stake), m: parseFloat(cfg.martingale), ps: cfg.primarySide, pd: cfg.primaryDigit, rs: cfg.recoverySide, rd: cfg.recoveryDigit });

    useEffect(() => { saveCfg({ stake, martingale, primarySide: pSide, primaryDigit: pDigit, recoverySide: rSide, recoveryDigit: rDigit }); }, [stake, martingale, pSide, pDigit, rSide, rDigit]);
    useEffect(() => { cfgRef.current = { s: parseFloat(stake) || 0.35, m: parseFloat(martingale) || 2, ps: pSide, pd: pDigit, rs: rSide, rd: rDigit }; }, [stake, martingale, pSide, pDigit, rSide, rDigit]);

    const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
        setLogs(p => [...p.slice(-200), { time: ts(), msg, type }]);
    }, []);

    const buy = useCallback(async (sym: string, side: ContractSide, digit: string, amt: number, phase: 'p' | 'r'): Promise<boolean> => {
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) return false;
        const ct = side === 'DIGITOVER' ? 'DIGITOVER' : 'DIGITUNDER';
        const lbl = side === 'DIGITOVER' ? `OVER ${digit}` : `UNDER ${digit}`;
        try {
            const r = await sendViaNewSystemWithPromise({ buy: 1, price: amt, parameters: { amount: amt, basis: 'stake', currency: 'USD', duration: 1, duration_unit: 't', symbol: sym, contract_type: ct, barrier: String(digit) } });
            const cid = r?.buy?.contract_id ?? r?.contract_id;
            if (cid) {
                cmapRef.current.set(String(cid), { sym, amt, phase });
                addLog(`${phase === 'p' ? 'PRIMARY' : 'RECOVERY'} | ${SYMBOL_LABELS[sym]}: ${lbl} D1 @ $${amt.toFixed(2)}`, 'trade');
                try { transactions.onBotContractEvent({ contract_id: cid, transaction_ids: { buy: r?.buy?.transaction_id }, buy_price: amt, currency: 'USD', contract_type: ct, underlying: sym, display_name: SYMBOL_LABELS[sym], date_start: Math.floor(Date.now() / 1000), status: 'open' } as any); } catch {}
                return true;
            }
            return false;
        } catch (e: any) { addLog(`BUY ERROR ${SYMBOL_LABELS[sym]}: ${e?.error?.message || e?.message}`, 'loss'); return false; }
    }, [addLog, transactions]);

    const handleResult = useCallback((profit: number, sym: string, amt: number, phase: 'p' | 'r') => {
        pnlRef.current += profit; setPnl(pnlRef.current);
        cntRef.current++; setTrades(cntRef.current);
        const won = profit >= 0;
        if (won) {
            addLog(`WON +$${profit.toFixed(2)} on ${SYMBOL_LABELS[sym]} | P&L: $${pnlRef.current.toFixed(2)}`, 'win');
            recovRef.current = false; lockRef.current = false;
        } else {
            addLog(`LOST -$${Math.abs(profit).toFixed(2)} on ${SYMBOL_LABELS[sym]} | P&L: $${pnlRef.current.toFixed(2)}`, 'loss');
            // Keep looping recovery until win — multiply stake each time
            recovRef.current = true;
            const next = Number((amt * cfgRef.current.m).toFixed(2));
            addLog(`RECOVERY LOOP: ${cfgRef.current.rs === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${cfgRef.current.rd} @ $${next.toFixed(2)}`, 'info');
            setTimeout(() => { buy(sym, cfgRef.current.rs, cfgRef.current.rd, next, 'r'); }, 0);
        }
        setSymProg(p => ({ ...p, [sym]: { ...p[sym], status: won ? 'won' : 'lost' } }));
    }, [addLog, buy]);

    // POC listener
    useEffect(() => {
        if (!running) return;
        if (window._newSystemWS?.readyState === WebSocket.OPEN) window._newSystemWS.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));
        const unsub = onNewSystemMessage((ev: MessageEvent) => {
            try {
                const d = JSON.parse(ev.data);
                if (d.msg_type !== 'proposal_open_contract') return;
                const c = d.proposal_open_contract;
                if (!c?.is_sold) return;
                const e = cmapRef.current.get(String(c.contract_id));
                if (!e) return;
                cmapRef.current.delete(String(c.contract_id));
                handleResult(Number(c.profit), e.sym, e.amt, e.phase);
            } catch {}
        });
        return () => { unsub(); };
    }, [running, handleResult]);

    // Tick handler
    useEffect(() => {
        if (!running) return;
        const unsub = onNewSystemMessage((ev: MessageEvent) => {
            if (!runRef.current) return;
            try {
                const d = JSON.parse(ev.data);

                // Handle bulk history response (fetched ticks on subscribe)
                if (d.msg_type === 'history' && d.history) {
                    const sym = d.echo_req?.ticks_history;
                    if (!sym) return;
                    const prices = d.history.prices;
                    if (!Array.isArray(prices)) return;
                    if (!bufRef.current[sym]) bufRef.current[sym] = [];
                    prices.forEach((p: any) => {
                        const digit = parseInt(String(p).slice(-1), 10);
                        if (!isNaN(digit)) bufRef.current[sym].push(digit);
                    });
                    if (bufRef.current[sym].length > 60) bufRef.current[sym] = bufRef.current[sym].slice(-60);
                    setSymProg(p => ({ ...p, [sym]: { symbol: sym, ticks: bufRef.current[sym].length, lastDigits: bufRef.current[sym].slice(-4), status: 'scanning' } }));
                    return;
                }

                // Handle live tick
                if (d.msg_type !== 'tick' || !d.tick) return;
                const sym = d.tick.symbol;
                const q = d.tick.quote;
                if (!sym || q === undefined) return;
                const digit = parseInt(String(q).slice(-1), 10);
                if (isNaN(digit)) return;
                if (!bufRef.current[sym]) bufRef.current[sym] = [];
                bufRef.current[sym].push(digit);
                if (bufRef.current[sym].length > 60) bufRef.current[sym] = bufRef.current[sym].slice(-60);
                const buf = bufRef.current[sym];

                setSymProg(p => ({ ...p, [sym]: { symbol: sym, ticks: (p[sym]?.ticks || 0) + 1, lastDigits: buf.slice(-4), status: lockRef.current ? 'trading' : 'scanning' } }));

                if (lockRef.current) return;
                const side = recovRef.current ? cfgRef.current.rs : cfgRef.current.ps;
                const digit_ = recovRef.current ? cfgRef.current.rd : cfgRef.current.pd;

                // Step 1: Check pattern (last 4 digits)
                if (buf.length < 4 || !checkPattern(buf, side)) return;

                // Step 2: Check dominance (last 25 ticks) — if fails, skip trade
                if (!hotDigitDominates(buf, side)) {
                    addLog(`PATTERN BLOCKED ${SYMBOL_LABELS[sym]}: dominance failed | [${buf.slice(-4).join(',')}]`, 'loss');
                    bufRef.current[sym] = [];
                    return;
                }

                // Both conditions met — execute
                const last25 = buf.slice(-25);
                const low = last25.filter(d => d <= 4).length;
                const high = last25.filter(d => d >= 5).length;
                addLog(`PATTERN ${SYMBOL_LABELS[sym]}: [${buf.slice(-4).join(',')}] | Low:${low} High:${high}`, 'pattern');
                lockRef.current = true;
                const amt = recovRef.current ? Number((cfgRef.current.s * cfgRef.current.m).toFixed(2)) : cfgRef.current.s;
                buy(sym, side, digit_, amt, recovRef.current ? 'r' : 'p');
                bufRef.current[sym] = [];
            } catch {}
        });
        return () => { unsub(); };
    }, [running, addLog, buy]);

    const start = useCallback(() => {
        if (running) return;
        runRef.current = true; setRunning(true);
        lockRef.current = false; recovRef.current = false;
        cmapRef.current.clear(); bufRef.current = {};
        pnlRef.current = 0; cntRef.current = 0; setPnl(0); setTrades(0); setLogs([]);

        addLog(`START | Stake: $${cfgRef.current.s} | MG: ${cfgRef.current.m}x | ${cfgRef.current.ps === 'DIGITUNDER' ? 'UNDER' : 'OVER'} ${cfgRef.current.pd} -> ${cfgRef.current.rs === 'DIGITUNDER' ? 'UNDER' : 'OVER'} ${cfgRef.current.rd}`, 'info');

        if (!wsRef.current) {
            wsRef.current = openMakotiWS(() => {}, () => { setConn(true); addLog('Connected to WebSocket', 'info'); subscribeAll(); }, () => { setConn(false); }, { skipAuth: true });
        } else {
            subscribeAll();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running, addLog]);

    const stop = useCallback(() => {
        runRef.current = false; setRunning(false);
        lockRef.current = false; recovRef.current = false;
        unsubscribeAll();
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
        addLog('STOPPED', 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addLog]);

    const subscribeAll = useCallback(() => {
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) return;
        ALL_SYMBOLS.forEach(sym => {
            // Don't clear buffer if already has data from previous subscription
            if (!bufRef.current[sym] || bufRef.current[sym].length === 0) {
                bufRef.current[sym] = [];
            }
            setSymProg(p => ({ ...p, [sym]: { symbol: sym, ticks: p[sym]?.ticks || 0, lastDigits: p[sym]?.lastDigits || [], status: 'scanning' } }));
            // Fetch last 50 ticks upfront so we can trade immediately
            window._newSystemWS.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: 50, end: 'latest', subscribe: 1 }));
        });
        addLog(`Subscribed to ${ALL_SYMBOLS.length} volatilities — loading 50 ticks each`, 'info');
    }, [addLog]);

    const unsubscribeAll = useCallback(() => {
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) return;
        ALL_SYMBOLS.forEach(sym => window._newSystemWS.send(JSON.stringify({ forget_all: sym })));
    }, []);

    useEffect(() => { return () => { runRef.current = false; unsubscribeAll(); if (wsRef.current) { wsRef.current.close(); wsRef.current = null; } }; }, [unsubscribeAll]);

    return (
        <div className='mw-uum under-kill-theme'>
            <div className='mw-uum__controls'>
                <div className='mw-field'>
                    <label className='mw-label'>Stake ($)</label>
                    <input className='mw-input' type='number' step='0.01' min='0' value={stake} onChange={e => setStake(e.target.value)} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Martingale (x)</label>
                    <input className='mw-input' type='number' step='0.1' min='1' value={martingale} onChange={e => setMartingale(e.target.value)} disabled={running} />
                </div>
            </div>

            <div className='mw-uum__section'>
                <div className='mw-uum__section-title'>Primary Option</div>
                <div className='mw-uum__controls'>
                    <div className='mw-field'>
                        <label className='mw-label'>Contract Type</label>
                        <MwSelect value={pSide} options={[{ value: 'DIGITUNDER', label: 'UNDER' }, { value: 'DIGITOVER', label: 'OVER' }]}
                            onChange={v => setPSide(v as ContractSide)} disabled={running} />
                    </div>
                    <div className='mw-field'>
                        <label className='mw-label'>Prediction Digit</label>
                        <MwSelect value={pDigit} options={[0,1,2,3,4,5,6,7,8,9].map(d => ({ value: String(d), label: String(d) }))}
                            onChange={v => setPDigit(v)} disabled={running} />
                    </div>
                </div>
            </div>

            <div className='mw-uum__section'>
                <div className='mw-uum__section-title'>Recovery Option</div>
                <div className='mw-uum__controls'>
                    <div className='mw-field'>
                        <label className='mw-label'>Contract Type</label>
                        <MwSelect value={rSide} options={[{ value: 'DIGITOVER', label: 'OVER' }, { value: 'DIGITUNDER', label: 'UNDER' }]}
                            onChange={v => setRSide(v as ContractSide)} disabled={running} />
                    </div>
                    <div className='mw-field'>
                        <label className='mw-label'>Prediction Digit</label>
                        <MwSelect value={rDigit} options={[0,1,2,3,4,5,6,7,8,9].map(d => ({ value: String(d), label: String(d) }))}
                            onChange={v => setRDigit(v)} disabled={running} />
                    </div>
                </div>
            </div>

            <button className={`mw-btn ${running ? 'mw-btn--stop' : 'mw-btn--kill'}`} onClick={running ? stop : start}>
                {running ? 'STOP' : 'RUN'}
            </button>

            <div className='mw-uum__stats'>
                <span>P&L: <b className={pnl >= 0 ? 'mw-win' : 'mw-loss'}>${pnl.toFixed(2)}</b></span>
                <span>Trades: {trades}</span>
                <span className={conn ? 'mw-win' : 'mw-loss'}>{conn ? 'Connected' : 'Disconnected'}</span>
            </div>

            <div className='mw-uum__progress'>
                <div className='mw-uum__progress-title'>Volatility Progress</div>
                {ALL_SYMBOLS.map(sym => {
                    const p = symProg[sym];
                    return (
                        <div key={sym} className={`mw-uum__prog-row ${p?.status === 'trading' ? 'mw-uum__prog-row--active' : ''} ${p?.status === 'won' ? 'mw-uum__prog-row--won' : ''} ${p?.status === 'lost' ? 'mw-uum__prog-row--lost' : ''}`}>
                            <span className='mw-uum__prog-sym'>{SYMBOL_LABELS[sym]}</span>
                            <span className='mw-uum__prog-digits'>{p?.lastDigits?.length ? p.lastDigits.join(' ') : '...'}</span>
                            <span className='mw-uum__prog-ticks'>{p?.ticks || 0}</span>
                            <span className={`mw-uum__prog-status mw-uum__prog-status--${p?.status || 'idle'}`}>{p?.status || 'idle'}</span>
                        </div>
                    );
                })}
            </div>

            <div className='mw-uum__logs'>
                {logs.map((l, i) => (
                    <div key={i} className={`mw-log-line mw-log-line--${l.type}`}>
                        <span className='mw-log-time'>{l.time}</span>
                        <span className='mw-log-msg'>{l.msg}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
