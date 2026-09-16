import React from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS } from '../makoti-ws';
import { useMarketKiller } from './use-market-killer';

export const MarketKiller: React.FC = () => {
    const engine = useMarketKiller();
    const {
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
        start,
        stop,
        clearLogs,
        getCurrentStake,
        getMaxDir,
        isVirtualMode,
    } = engine;

    const totalWins = Object.values(symDisplay).reduce((a, b) => a + b.wins, 0);
    const totalLosses = Object.values(symDisplay).reduce((a, b) => a + b.losses, 0);
    const totalTrades = totalWins + totalLosses;
    const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '\u2014';
    const currentStake = getCurrentStake();

    return (
        <div className='mw-killer market-killer-theme'>
            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Stake ($)</label>
                    <input
                        className='mw-input'
                        type='number'
                        min='0.35'
                        step='0.01'
                        value={stake}
                        onChange={e => setStake(e.target.value)}
                        disabled={running}
                    />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Martingale x</label>
                    <input
                        className='mw-input'
                        type='number'
                        min='1'
                        step='0.1'
                        value={martingale}
                        onChange={e => setMartingale(e.target.value)}
                        disabled={running}
                    />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Take Profit ($)</label>
                    <input
                        className='mw-input'
                        type='number'
                        min='0.5'
                        step='0.5'
                        value={takeProfit}
                        onChange={e => setTakeProfit(e.target.value)}
                        disabled={running}
                    />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Stop Loss ($)</label>
                    <input
                        className='mw-input'
                        type='number'
                        min='0.5'
                        step='0.5'
                        value={stopLoss}
                        onChange={e => setStopLoss(e.target.value)}
                        disabled={running}
                    />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Max Tick Direction</label>
                    <input
                        className='mw-input'
                        type='number'
                        min='2'
                        max='20'
                        step='1'
                        value={maxDir}
                        onChange={e => setMaxDir(e.target.value)}
                        disabled={running}
                    />
                </div>
            </div>
            <div className='mw-killer__vh'>
                <label className='mw-killer__vh-toggle'>
                    <input
                        type='checkbox'
                        checked={vhEnabled}
                        onChange={e => setVhEnabled(e.target.checked)}
                        disabled={running}
                    />
                    <span>Virtual Hook</span>
                </label>
                {vhEnabled && (
                    <div className='mw-field mw-killer__vh-threshold'>
                        <label className='mw-label'>Loss Threshold:</label>
                        <input
                            className='mw-input'
                            type='number'
                            min='1'
                            step='1'
                            value={vhThreshold}
                            onChange={e => setVhThreshold(e.target.value)}
                            disabled={running}
                        />
                    </div>
                )}
            </div>
            <button
                className={`mw-btn${running ? ' mw-btn--stop' : ' mw-btn--kill'}`}
                onClick={running ? stop : start}
            >
                {running ? (
                    <>
                        <span className='mw-pulse' /> STOP KILLER
                    </>
                ) : (
                    'KILL MARKET'
                )}
            </button>
            {running && (
                <div className='mw-killer__mode-note'>
                    Tick Direction {'\u2014'} trade opposite after N consecutive ticks
                    {isVirtualMode && <span className='mw-da__prog-status--recovery'> VIRTUAL MODE</span>}
                    {!isVirtualMode && vhEnabled && <span className='mw-win'> REAL MODE</span>}
                </div>
            )}
            {(running || totalTrades > 0) && (
                <div className='mw-killer__stats'>
                    <div className={`mw-killer__pnl${pnl >= 0 ? ' mw-killer__pnl--pos' : ' mw-killer__pnl--neg'}`}>
                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </div>
                    <div className='mw-killer__meta'>
                        <span>Trades: {totalTrades}</span>
                        <span>
                            W/L: {totalWins}/{totalLosses}
                        </span>
                        <span>Win rate: {winRate}%</span>
                        <span>Stake: ${currentStake.toFixed(2)}</span>
                    </div>
                </div>
            )}
            <div className='mw-killer__symbols'>
                <div className='mw-da__progress-title'>Volatility Directions</div>
                {ALL_SYMBOLS.map(sym => {
                    const ss = symDisplay[sym];
                    if (!ss) {
                        return (
                            <div key={sym} className='mw-killer__sym-row'>
                                <span className='mw-killer__sym-name'>{SYMBOL_LABELS[sym]}</span>
                                <span className='mw-killer__sym-signal'>{'\u2014'}</span>
                            </div>
                        );
                    }
                    const baseStake = parseFloat(stake) || 0.35;
                    const isMgActive = ss.stake > baseStake + 0.001;
                    const maxDirVal = getMaxDir();
                    const dirPct = maxDirVal > 0 ? Math.min((ss.dirCount / maxDirVal) * 100, 100) : 0;
                    return (
                        <div key={sym} className='mw-killer__sym-row'>
                            <span className='mw-killer__sym-name'>{SYMBOL_LABELS[sym]}</span>
                            <span className='mw-killer__sym-digit' title='Last digit'>
                                {ss.digit ?? '\u2014'}
                            </span>
                            <span className='mw-killer__sym-signal' title='Direction'>
                                {ss.dir === 'up' ? '\u2191' : ss.dir === 'down' ? '\u2193' : '\u2014'}
                                {ss.dirCount}
                            </span>
                            <div
                                style={{
                                    width: 60,
                                    height: 6,
                                    background: '#1e293b',
                                    borderRadius: 3,
                                    overflow: 'hidden',
                                }}
                            >
                                <div
                                    style={{
                                        width: `${dirPct}%`,
                                        height: '100%',
                                        background: dirPct >= 100 ? '#ef4444' : '#f97316',
                                        borderRadius: 3,
                                        transition: 'width 0.3s',
                                    }}
                                />
                            </div>
                            <span className='mw-killer__sym-wl'>
                                <span className='mw-win'>{ss.wins}W</span>
                                <span className='mw-loss'>{ss.losses}L</span>
                            </span>
                            {isMgActive && <span className='mw-killer__sym-stake'>${ss.stake.toFixed(2)}</span>}
                        </div>
                    );
                })}
            </div>
            {logs.length > 0 && (
                <div className='mw-killer__log-wrap'>
                    <div className='mw-killer__log-header'>
                        <span className='mw-killer__log-title'>Activity Log</span>
                        <button className='mw-btn-clear' onClick={clearLogs}>
                            Clear
                        </button>
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
