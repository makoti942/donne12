import React from 'react';
import { useAiAnalyst } from '@/pages/manual-trade/use-ai-analyst';
import { AiFocus } from '@/pages/manual-trade/ai-analyst';

const FOCUS_LABELS: Record<AiFocus, string> = {
    auto: 'Auto (All)',
    'matches-differs': 'Matches/Differs',
    'over-under': 'Over/Under',
    'even-odd': 'Even/Odd',
};

const TYPE_LABELS = [
    { key: 'DIGITOVER', label: 'Over' },
    { key: 'DIGITUNDER', label: 'Under' },
    { key: 'DIGITMATCH', label: 'Match' },
    { key: 'DIGITDIFF', label: 'Differs' },
];

export const AiAnalystStrategy: React.FC = () => {
    const ai = useAiAnalyst({
        focusType: 'auto',
        allowedTypes: { DIGITOVER: true, DIGITUNDER: true, DIGITDIFF: true, DIGITMATCH: false },
    });
const {
    focusType, allowedTypes, stake, takeProfit, stopLoss, autoRun, stakeMultiplierEnabled,
    phase, isBusy, plan, progress, logs, analyze, startRun, stopRun, setFocusType, toggleAllowedType,
    setStake, setTakeProfit, setStopLoss, setAutoRun, setStakeMultiplierEnabled } = ai;
const running = phase === 'running';

    return (
        <div className='mw-killer ai-analyst-theme'>
            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Focus</label>
                    <select
                        className='mw-input'
                        value={focusType}
                        onChange={e => setFocusType(e.target.value as AiFocus)}
                        disabled={running}
                    >
                        {Object.entries(FOCUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                </div>
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
                    <label className='mw-label'>Take Profit ($)</label>
                    <input
                        className='mw-input'
                        type='number'
                        min='0'
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
                        min='0'
                        step='0.5'
                        value={stopLoss}
                        onChange={e => setStopLoss(e.target.value)}
                        disabled={running}
                    />
                </div>
            </div>

            <div className='mw-killer__types'>
                <label className='mw-label'>Types</label>
                <div className='mw-types-row'>
                    {TYPE_LABELS.map(t => (
                        <label key={t.key} className='mw-type-cb'>
                            <input
                                type='checkbox'
                                checked={!!allowedTypes[t.key]}
                                onChange={() => toggleAllowedType(t.key)}
                                disabled={running}
                            />
                            <span>{t.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className='mw-killer__toggles'>
                <label className='mw-toggle-row'>
                    <input
                        type='checkbox'
                        checked={autoRun}
                        onChange={e => setAutoRun(e.target.checked)}
                        disabled={running}
                    />
                    <span className='mw-toggle-label'>Auto-run</span>
                </label>
                <label className='mw-toggle-row'>
                    <input
                        type='checkbox'
                        checked={stakeMultiplierEnabled}
                        onChange={e => setStakeMultiplierEnabled(e.target.checked)}
                        disabled={running}
                    />
                    <span className='mw-toggle-label'>Stake ×</span>
                </label>
            </div>

            <div className='mw-killer__actions'>
                <button
                    className={`mw-btn mw-btn--analyze${isBusy ? ' mw-btn--busy' : ''}`}
                    disabled={isBusy || running}
                    onClick={() => void analyze()}
                >
                    {isBusy ? <><span className='mw-spin' /> Analyzing…</> : 'Analyze'}
                </button>
                {running ? (
                    <button className='mw-btn mw-btn--stop' onClick={() => void stopRun()}>
                        Stop
                    </button>
                ) : (
                    <button
                        className='mw-btn mw-btn--run'
                        disabled={!ai.plan || isBusy}
                        onClick={() => void startRun()}
                    >
                        Run
                    </button>
                )}
            </div>

            {progress && <div className='mw-killer__progress'>{progress}</div>}

            {plan && (
                <div className='mw-killer__plan'>
                    <div className='mw-killer__plan-head'>
                        <span className='mw-killer__plan-market'>{plan.market}</span>
                        <span className='mw-killer__plan-contract'>
                            {plan.contract_type.replace('DIGIT', '')}
                            {plan.barrier_digit != null ? ` ${plan.barrier_digit}` : ''}
                        </span>
                        <span className='mw-killer__plan-dur'>{plan.duration_ticks}t</span>
                        <span className={`mw-killer__conf ${plan.confidence >= 60 ? 'mw-killer__conf--hi' : plan.confidence >= 40 ? 'mw-killer__conf--mid' : 'mw-killer__conf--low'}`}>
                            {plan.confidence}%
                        </span>
                    </div>
                    <div className='mw-killer__plan-stakes'>
                        <div className='mw-killer__plan-stake'>
                            <span className='mw-killer__plan-stake-lbl'>Stake</span>
                            <span className='mw-killer__plan-stake-val'>{plan.stake.toFixed(2)}</span>
                        </div>
                        <div className='mw-killer__plan-stake'>
                            <span className='mw-killer__plan-stake-lbl'>Payout</span>
                            <span className='mw-killer__plan-stake-val'>{plan.payout.toFixed(2)}</span>
                        </div>
                        <div className='mw-killer__plan-stake'>
                            <span className='mw-killer__plan-stake-lbl'>Profit</span>
                            <span className='mw-killer__plan-stake-val'>{plan.profit.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            )}

            <div className='mw-killer__logs'>
                <div className='mw-killer__logs-head'>Live Log</div>
                <div className='mw-killer__log-list'>
                    {logs.length === 0 ? (
                        <div className='mw-killer__log-empty'>Press Analyze to start.</div>
                    ) : (
                        logs.map((l, i) => (
                            <div key={i} className='mw-killer__log-line'>{l.msg}</div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};