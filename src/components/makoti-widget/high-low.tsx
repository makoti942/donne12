import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SYMBOL_LABELS, openMakotiWS, MakotiWS } from './makoti-ws';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import {
    HL_SYMBOLS, Candle,
    buildCandles, getBandTouch, stepPattern, newPattern,
    tickDirection, TickPattern, BbTouch,
    MAX_TICKS, MIN_TICKS, MIN_STREAK, HISTORY_COUNT, BB_PERIOD,
} from './high-low-engine';

interface SymData {
    prices: number[];
    times: number[];
    pat: TickPattern;
    candles: Candle[];
    ready: boolean;
}

interface BoardRow {
    side: 'upper' | 'lower' | null;
    streak: number;
    awaiting: boolean;
    price: number;
    bb: { upper: number; middle: number; lower: number } | null;
}

interface Signal {
    symbol: string;
    action: 'RUNHIGH' | 'RUNLOW';
    time: string;
}

function shortSym(sym: string): string {
    return sym.startsWith('1HZ') ? `1s${sym.slice(4, -1)}` : `V${sym.slice(2)}`;
}

export const HighLow: React.FC = () => {
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState('');
    const [board, setBoard] = useState<Record<string, BoardRow>>({});
    const [signal, setSignal] = useState<Signal | null>(null);
    const [streamAlive, setStreamAlive] = useState(false);
    const [maxCandles, setMaxCandles] = useState(0);
    const [logs, setLogs] = useState<{ time: string; msg: string; type: string }[]>([]);

    const wsRef = useRef<MakotiWS | null>(null);
    const sdRef = useRef<Record<string, SymData>>({});
    const runningRef = useRef(false);
    const generationRef = useRef(0);
    const lastFireRef = useRef(0);
    const lastTickRef = useRef(0);
    const lastDataLogRef = useRef(0);
    const maxCandlesRef = useRef(0);
    const diagRef = useRef(0);
    const lastErrorRef = useRef('');
    const lastFullResetRef = useRef(0);
    const rateLimitedUntilRef = useRef(0);

    const addLog = useCallback((msg: string, type: string = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 100));
    }, []);

    const clearLogs = useCallback(() => { setLogs([]); }, []);

    const copyLogs = useCallback(() => {
        const text = logs.map(l => `[${l.time}] ${l.msg}`).join('\n');
        if (!text) return;
        const done = () => addLog('Activity log copied to clipboard', 'info');
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    done();
                } catch { addLog('Copy failed — select the log manually', 'info'); }
            });
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            done();
        }
    }, [logs, addLog]);

    const updateBoard = useCallback((sym: string) => {
        const sd = sdRef.current[sym];
        if (!sd) return;
        const touch = getBandTouch(sd.candles);
        setBoard(prev => ({
            ...prev,
            [sym]: {
                side: sd.pat.side,
                streak: sd.pat.streak,
                awaiting: sd.pat.awaitingReversal,
                price: sd.prices[sd.prices.length - 1] ?? 0,
                bb: touch?.bb ?? null,
            },
        }));
    }, []);

    const stopEngine = useCallback(() => {
        runningRef.current = false;
        generationRef.current++;
        setRunning(false);
        setBoard({});
        setSignal(null);
        setStreamAlive(false);
        setStatus('Stopped');
        try { wsRef.current?.close(); } catch {}
        wsRef.current = null;
        addLog('HIGH/LOW signal engine stopped.', 'info');
    }, [addLog]);

    const handleTick = useCallback((sym: string, price: number, epoch: number) => {
        if (!runningRef.current) return;
        const sd = sdRef.current[sym];
        if (!sd) return;

        const prev = sd.prices[sd.prices.length - 1];
        sd.prices = [...sd.prices.slice(-(MAX_TICKS - 1)), price];
        sd.times = [...sd.times.slice(-(MAX_TICKS - 1)), epoch];
        lastTickRef.current = Math.max(lastTickRef.current, epoch);
        sd.ready = sd.prices.length >= MIN_TICKS;

        if (!sd.ready) {
            setBoard(prev => ({
                ...prev,
                [sym]: { side: null, streak: 0, awaiting: false, price, bb: null },
            }));
            return;
        }

        const candles = buildCandles(sd.prices, sd.times);
        if (candles.length >= BB_PERIOD + 1) {
            sd.candles = candles;
            if (candles.length > maxCandlesRef.current) {
                maxCandlesRef.current = candles.length;
                setMaxCandles(candles.length);
            }
        }
        const touch = getBandTouch(sd.candles);
        const prevSide = sd.pat.side;
        const dir = tickDirection(prev, price);
        const res = stepPattern(sd.pat, touch, dir);
        sd.pat = res.pat;

        if (res.pat.side && res.pat.side !== prevSide) {
            addLog(
                `📊 ${SYMBOL_LABELS[sym] || sym} touching ${res.pat.side.toUpperCase()} band — waiting for ${MIN_STREAK}+ ${res.pat.side === 'upper' ? 'UP' : 'DOWN'} ticks`,
                'info'
            );
        }

        if (res.fire && res.action && runningRef.current) {
            const now = Date.now();
            if (now - lastFireRef.current < 3000) return;
            lastFireRef.current = now;
            const label = res.action === 'RUNHIGH' ? 'ONLY UPS' : 'ONLY DOWNS';
            const time = new Date().toLocaleTimeString();
            setSignal({ symbol: sym, action: res.action, time });
            addLog(`🚨 RUN BOT — ${SYMBOL_LABELS[sym] || sym} ${label} 2 ticks @ ${time}`, 'trigger');
            setStatus(`🚨 SIGNAL READY — run bot: ${label} on ${SYMBOL_LABELS[sym] || sym}`);
            updateBoard(sym);
        } else {
            updateBoard(sym);
        }
    }, [addLog, updateBoard]);

    const tickRef = useRef(handleTick);
    tickRef.current = handleTick;

    const subscribeAllSymbols = useCallback((forceFull: boolean = false) => {
        const wsState = window._newSystemWS?.readyState;
        if (wsState !== WebSocket.OPEN) {
            // NEVER recreate the socket here: the app owns the connection and its
            // OTP/session (wss://.../ws/demo?otp=... is single-use). Recreating it
            // with a consumed/expired OTP breaks the whole app (blank market data).
            // The app's own reconnect logic handles recovery.
            addLog(`DBG subscribe skipped: wsState=${wsState}`, 'info');
            return;
        }
        HL_SYMBOLS.forEach(sym => {
            // forget_all ONLY on a full reset — clears the widget's count:1
            // subscription so the server returns full history with the new
            // subscription. (Note: `forget` takes a subscription id, not a
            // symbol — the public socket rejects `forget: <symbol>`.)
            if (forceFull) {
                window._newSystemWS.send(JSON.stringify({ forget_all: sym }));
            }
            // full-history streaming subscription: initial response = 5000 ticks
            window._newSystemWS.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: HISTORY_COUNT, end: 'latest', subscribe: 1 }));
        });
        addLog(forceFull ? 'Full reset: forget + history for all symbols' : 'Re-subscribed tick streams', 'info');
    }, [addLog]);

    // Watchdog: if no ticks arrive, say so and re-subscribe (self-healing).
    // Throttled hard: repeated full resets spam `forget` and trip the server's
    // per-message rate limits (which then also block `time`/`history` responses).
    const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const forceFullRef = useRef(false);
    useEffect(() => {
        if (!running) return;
        watchdogRef.current = setInterval(() => {
            if (!runningRef.current) return;
            const now = Date.now() / 1000;
            const idle = now - lastTickRef.current;
            setStreamAlive(idle <= 5);
            if (idle <= 5) return;
            if (now < rateLimitedUntilRef.current) return;
            if (now - lastDataLogRef.current < 10) return;
            lastDataLogRef.current = now;
            const wsState = window._newSystemWS?.readyState;
            const wsLabel = wsState === WebSocket.OPEN ? 'open' : wsState === WebSocket.CONNECTING ? 'connecting' : wsState === WebSocket.CLOSED ? 'closed' : 'closing';
            if (wsState !== WebSocket.OPEN) {
                addLog(`⚠ WebSocket ${wsLabel} — Deriv session may have expired. Stop, re-login if needed, then RUN again.`, 'info');
                setStatus(`WS ${wsLabel} — session may have expired`);
                return;
            }
            // full reset (forget + history) only when ticks have been dead a while
            // AND the last full reset was more than a minute ago
            const full = idle > 20 && now - lastFullResetRef.current > 60;
            if (full) lastFullResetRef.current = now;
            forceFullRef.current = full;
            addLog(`⚠ No tick data for ${Math.round(idle)}s (WS: ${wsLabel}) — ${full ? 'full reset' : 're-subscribing'}`, 'info');
            setStatus(`No tick data (WS ${wsLabel}) — ${full ? 'full reset' : 're-subscribing'}...`);
            subscribeAllSymbols(full);
        }, 3000);
        return () => { if (watchdogRef.current) clearInterval(watchdogRef.current); };
    }, [running, addLog, subscribeAllSymbols]);

    const startEngine = useCallback(() => {
        generationRef.current++;
        lastFireRef.current = 0;
        lastTickRef.current = 0;
        lastDataLogRef.current = Date.now() / 1000;
        lastFullResetRef.current = Date.now() / 1000;
        rateLimitedUntilRef.current = 0;
        maxCandlesRef.current = 0;

        const hasData = Object.values(sdRef.current).some(sd => sd.prices.length > 0);
        if (!hasData) {
            sdRef.current = {};
            HL_SYMBOLS.forEach(sym => {
                sdRef.current[sym] = { prices: [], times: [], pat: newPattern(), candles: [], ready: false };
            });
        } else {
            HL_SYMBOLS.forEach(sym => {
                if (!sdRef.current[sym]) sdRef.current[sym] = { prices: [], times: [], pat: newPattern(), candles: [], ready: false };
            });
        }

        runningRef.current = true;
        setRunning(true);
        setBoard({});
        setSignal(null);
        setMaxCandles(0);
        setStatus('Connected — loading 1m candles from history...');
        setLogs([]);

        addLog(`HIGH/LOW SIGNALS v10 — ${HL_SYMBOLS.length} volatilities | BB(${BB_PERIOD},${2}) 1m candles | signal only, no trades`, 'info');

        if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }

        // One forget + history pass up front: clears the widget's count:1
        // subscriptions so the server returns full history immediately.
        subscribeAllSymbols(true);

        const mws = openMakotiWS(
            (data: any) => {
                if (!runningRef.current) return;
                const mt = data?.msg_type;
                if (mt !== 'tick' && mt !== 'history' && mt !== 'candles' && mt !== 'error') {
                    if (data?.error && /rate limit/i.test(`${data.error.message || ''} ${data.error.code || ''}`)) {
                        const now = Date.now() / 1000;
                        if (now > rateLimitedUntilRef.current) {
                            rateLimitedUntilRef.current = now + 60;
                            addLog(`⚠ Rate limited on ${mt} — backing off 60s`, 'info');
                        }
                        return;
                    }
                    if (Date.now() - diagRef.current > 2000) {
                        diagRef.current = Date.now();
                        const err = data?.error ? ` err=${data.error.message || data.error.code || '?'}` : '';
                        addLog(`DBG rx type=${mt}${err} keys=[${Object.keys(data || {}).join(',')}]`, 'info');
                    }
                }
                if (mt === 'error') {
                    const e = data.error || {};
                    const msg = e.message || e.code || 'unknown';
                    if (/rate limit/i.test(msg)) {
                        const now = Date.now() / 1000;
                        if (now > rateLimitedUntilRef.current) {
                            rateLimitedUntilRef.current = now + 60;
                            addLog(`⚠ Rate limited — backing off 60s`, 'info');
                        }
                        return;
                    }
                    if (msg !== lastErrorRef.current) {
                        lastErrorRef.current = msg;
                        addLog(`⚠ SERVER ERROR: ${msg}`, 'info');
                    }
                    if (/unrecognised|unrecognized/i.test(msg)) {
                        // The connection/session is invalid (stale/consumed OTP) —
                        // retrying is futile and spams the server. Stop cleanly.
                        addLog('Stopped — Deriv session invalid. Re-login, then press RUN again.', 'info');
                        stopEngine();
                        return;
                    }
                    const now = Date.now() / 1000;
                    if (now - lastDataLogRef.current > 10) {
                        lastDataLogRef.current = now;
                        setStatus(`Server error: ${msg} — re-subscribing`);
                        subscribeAllSymbols(forceFullRef.current);
                    }
                    return;
                }
                if (mt === 'history') {
                    const sym: string = data.echo_req?.ticks_history;
                    if (!sym || !sdRef.current[sym]) return;
                    const sd = sdRef.current[sym];
                    const rawPrices = data.history?.prices;
                    if (!Array.isArray(rawPrices) || rawPrices.length === 0) return;
                    const prices = rawPrices.map((p: any) => Number(p));
                    const rawTimes = data.history?.times;
                    const times = Array.isArray(rawTimes) && rawTimes.length === prices.length
                        ? rawTimes.map((t: any) => Number(t))
                        : prices.map((_, i) => Math.floor(Date.now() / 1000) - (prices.length - 1 - i));
                    sd.prices = prices.length >= sd.prices.length ? prices.slice(-MAX_TICKS) : sd.prices;
                    sd.times = times.length >= sd.times.length ? times.slice(-MAX_TICKS) : sd.times;
                    const candles = buildCandles(sd.prices, sd.times);
                    if (candles.length > 0) {
                        sd.candles = candles;
                        maxCandlesRef.current = Math.max(maxCandlesRef.current, candles.length);
                        setMaxCandles(maxCandlesRef.current);
                    }
                    sd.ready = sd.prices.length >= MIN_TICKS;
                    sd.pat = newPattern();
                    lastTickRef.current = Math.max(lastTickRef.current, sd.times[sd.times.length - 1] ?? 0);
                    const readyCount = HL_SYMBOLS.filter(s => sdRef.current[s]?.ready).length;
                    addLog(`History ${SYMBOL_LABELS[sym] || sym}: ${sd.prices.length} ticks -> ${candles.length} 1m candles (${readyCount}/10 ready)`, 'info');
                    updateBoard(sym);
                    return;
                }
                if (mt === 'tick') {
                    const tick = data.tick;
                    if (!tick) return;
                    const sym: string = tick.symbol;
                    if (!HL_SYMBOLS.includes(sym) || !sdRef.current[sym]) return;
                    const price = Number(tick.quote);
                    const epoch = tick.epoch ? Number(tick.epoch) : Math.floor(Date.now() / 1000);
                    if (!price) return;
                    tickRef.current(sym, price, epoch);
                }
            },
            () => {
                if (!runningRef.current) return;
                addLog('Live tick stream active — monitoring BB bands', 'info');
                setStatus('Monitoring Bollinger Bands — signals only');
                // plain subscribe on (re)open: a fresh socket has no stale
                // subscriptions, so forgets here would just burn the rate limit
                subscribeAllSymbols(false);
            },
            () => {
                if (runningRef.current) { addLog('Connection lost. Stopping.', 'info'); stopEngine(); }
            },
        );
        wsRef.current = mws;
    }, [addLog, stopEngine, subscribeAllSymbols]);

    useEffect(() => {
        return () => {
            runningRef.current = false;
            try { wsRef.current?.close(); } catch {}
        };
    }, []);

    const touchingCount = HL_SYMBOLS.filter(s => board[s]?.side).length;
    const activeSym = HL_SYMBOLS
        .filter(s => board[s]?.side)
        .sort((a, b) => {
            const wa = (board[a].awaiting ? 2 : 0) + Math.min(board[a].streak, MIN_STREAK) / MIN_STREAK;
            const wb = (board[b].awaiting ? 2 : 0) + Math.min(board[b].streak, MIN_STREAK) / MIN_STREAK;
            return wb - wa;
        })[0] ?? null;
    const active = activeSym ? board[activeSym] : null;

    const phaseLabel = !running ? 'OFF' : signal ? 'SIGNAL!' : active?.awaiting ? 'REVERSAL?' : active?.side ? 'TRACKING' : 'SCANNING';
    const phaseColor = !running ? '#6b7280' : signal ? '#ef4444' : active?.awaiting ? '#f59e0b' : active?.side ? '#f97316' : '#6b7280';

    return (
        <div className='mw-killer high-low-theme'>
            <button className={`mw-btn${running ? ' mw-btn--stop' : ' mw-btn--kill'}`}
                onClick={running ? stopEngine : startEngine}>
                {running ? <><span className='mw-pulse' /> STOP</> : 'RUN'}
            </button>

            {running && signal && (
                <div style={{
                    marginTop: 8,
                    padding: '10px 12px',
                    borderRadius: 6,
                    background: 'rgba(239,68,68,0.15)',
                    border: '2px solid #ef4444',
                    animation: 'mw-blink 1s step-start infinite',
                }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>
                        🚨 RUN BOT
                    </div>
                    <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 2 }}>
                        {SYMBOL_LABELS[signal.symbol] || signal.symbol} —{' '}
                        {signal.action === 'RUNHIGH' ? 'ONLY UPS' : 'ONLY DOWNS'} · 2 ticks · {signal.time}
                    </div>
                </div>
            )}

            {running && (
                <div className='mw-killer__signal'>
                    <div className='mw-killer__signal-detail'>{status}</div>

                    {active && (
                        <div className='mw-killer__signal-strength'>
                            <span style={{ color: active.side === 'upper' ? '#ef4444' : '#22c55e' }}>
                                {SYMBOL_LABELS[activeSym!] || activeSym}
                            </span>
                            <span style={{ color: active.side === 'upper' ? '#ef4444' : '#22c55e', marginLeft: 8 }}>
                                {active.side === 'upper' ? 'UPPER BAND' : 'LOWER BAND'}
                            </span>
                            {active.streak > 0 && (
                                <span style={{ color: '#facc15', marginLeft: 8 }}>
                                    {active.streak} {active.side === 'upper' ? 'UP' : 'DOWN'} ticks
                                </span>
                            )}
                            {active.awaiting && (
                                <span style={{ color: '#f97316', marginLeft: 8 }}>awaiting reversal</span>
                            )}
                            <span style={{
                                display: 'inline-block',
                                marginLeft: 8,
                                padding: '1px 6px',
                                borderRadius: 3,
                                fontSize: 11,
                                fontWeight: 600,
                                background: phaseColor,
                                color: '#000',
                            }}>
                                {phaseLabel}
                            </span>

                            <div style={{ marginTop: 6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8' }}>
                                    <span>
                                        streak {Math.min(active.streak, MIN_STREAK)}/{MIN_STREAK} {active.side === 'upper' ? 'UP' : 'DOWN'}
                                    </span>
                                    <span>{active.awaiting ? 'waiting for reversal tick...' : 'building streak...'}</span>
                                </div>
                                <div style={{ height: 4, background: '#1e293b', borderRadius: 2, marginTop: 2 }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${Math.min(active.streak / MIN_STREAK, 1) * 100}%`,
                                        background: active.awaiting ? '#f59e0b' : '#facc15',
                                        borderRadius: 2,
                                        transition: 'width 0.15s linear',
                                    }} />
                                </div>
                            </div>

                            {active.bb && active.price > 0 && (
                                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'flex', gap: 12 }}>
                                    <span>Upper: <span style={{ color: '#ef4444' }}>{active.bb.upper.toFixed(4)}</span></span>
                                    <span>Mid: <span style={{ color: '#facc15' }}>{active.bb.middle.toFixed(4)}</span></span>
                                    <span>Lower: <span style={{ color: '#22c55e' }}>{active.bb.lower.toFixed(4)}</span></span>
                                    <span>Price: <span style={{ color: '#e2e8f0' }}>{active.price.toFixed(4)}</span></span>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ marginTop: 8, fontSize: 10, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                        <span>
                            Monitoring {HL_SYMBOLS.length} volatilities — {touchingCount} touching a band
                        </span>
                        <span>
                            candles{' '}
                            <span style={{ color: maxCandles >= BB_PERIOD + 1 ? '#22c55e' : '#f97316' }}>
                                {Math.min(maxCandles, BB_PERIOD + 1)}/{BB_PERIOD + 1}
                            </span>
                            {' · '}stream:{' '}
                            <span style={{ color: streamAlive ? '#22c55e' : '#ef4444' }}>
                                {streamAlive ? 'live' : 'no ticks'}
                            </span>
                        </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {HL_SYMBOLS.map(sym => {
                            const r = board[sym];
                            const t = r?.side === 'upper';
                            const b = r?.side === 'lower';
                            const borderColor = t ? '#ef4444' : b ? '#22c55e' : '#334155';
                            return (
                                <div key={sym} style={{
                                    flex: '1 1 16%',
                                    minWidth: 58,
                                    padding: '3px 6px',
                                    borderRadius: 4,
                                    fontSize: 10,
                                    background: '#1e293b',
                                    border: `1px solid ${borderColor}`,
                                    opacity: r?.side ? 1 : 0.45,
                                    textAlign: 'center',
                                }}>
                                    <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{shortSym(sym)}</div>
                                    <div style={{ color: r?.price ? '#e2e8f0' : '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                                        {typeof r?.price === 'number' && isFinite(r.price) ? r.price.toFixed(4) : '—'}
                                    </div>
                                    <div style={{ color: r?.awaiting ? '#f97316' : '#94a3b8' }}>
                                        {r?.side ? (t ? 'UPPER' : 'LOWER') : ''}{r?.streak ? ` · ${r.streak}` : ''}{r?.awaiting ? ' · REV' : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {logs.length > 0 && (
                <div className='mw-killer__log-wrap'>
                    <div className='mw-killer__log-header'>
                        <span className='mw-killer__log-title'>Activity Log</span>
                        <span style={{ display: 'flex', gap: 6 }}>
                            <button className='mw-btn-clear' onClick={copyLogs}>Copy</button>
                            <button className='mw-btn-clear' onClick={clearLogs}>Clear</button>
                        </span>
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

export default HighLow;