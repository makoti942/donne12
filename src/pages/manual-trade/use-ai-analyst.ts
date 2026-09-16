import { useState, useCallback, useRef } from 'react';
import { AiFocus, AiPlan } from './ai-analyst';

interface UseAiAnalystOptions {
    focusType: AiFocus;
    allowedTypes: Record<string, boolean>;
}

interface UseAiAnalystReturn {
    focusType: AiFocus;
    allowedTypes: Record<string, boolean>;
    stake: string;
    takeProfit: string;
    stopLoss: string;
    autoRun: boolean;
    stakeMultiplierEnabled: boolean;
    phase: 'idle' | 'analyzing' | 'running';
    isBusy: boolean;
    plan: AiPlan | null;
    progress: string;
    logs: { msg: string }[];
    analyze: () => Promise<void>;
    startRun: () => Promise<void>;
    stopRun: () => Promise<void>;
    setFocusType: (f: AiFocus) => void;
    toggleAllowedType: (t: string) => void;
    setStake: (s: string) => void;
    setTakeProfit: (s: string) => void;
    setStopLoss: (s: string) => void;
    setAutoRun: (v: boolean) => void;
    setStakeMultiplierEnabled: (v: boolean) => void;
}

export function useAiAnalyst(options: UseAiAnalystOptions): UseAiAnalystReturn {
    const [focusType, setFocusType] = useState<AiFocus>(options.focusType);
    const [allowedTypes, setAllowedTypes] = useState<Record<string, boolean>>(options.allowedTypes);
    const [stake, setStake] = useState('1');
    const [takeProfit, setTakeProfit] = useState('10');
    const [stopLoss, setStopLoss] = useState('50');
    const [autoRun, setAutoRun] = useState(false);
    const [stakeMultiplierEnabled, setStakeMultiplierEnabled] = useState(false);
    const [phase, setPhase] = useState<'idle' | 'analyzing' | 'running'>('idle');
    const [plan, setPlan] = useState<AiPlan | null>(null);
    const [progress, setProgress] = useState('');
    const [logs, setLogs] = useState<{ msg: string }[]>([]);
    const busyRef = useRef(false);

    const isBusy = phase === 'analyzing';

    const toggleAllowedType = useCallback((t: string) => {
        setAllowedTypes(prev => ({ ...prev, [t]: !prev[t] }));
    }, []);

    const addLog = useCallback((msg: string) => {
        setLogs(prev => [...prev.slice(-50), { msg }]);
    }, []);

    const analyze = useCallback(async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setPhase('analyzing');
        setProgress('Analyzing market...');
        addLog('AI Analyst: Analyzing market data...');

        try {
            // Placeholder - in production this would call requestAiPlan
            setProgress('No plan generated - AI analyst not yet configured');
            addLog('AI Analyst: Feature not yet configured for this deployment.');
        } catch (e: any) {
            addLog(`Error: ${e.message}`);
        } finally {
            busyRef.current = false;
            setPhase('idle');
            setProgress('');
        }
    }, [addLog]);

    const startRun = useCallback(async () => {
        if (!plan) return;
        setPhase('running');
        addLog('AI Analyst: Starting automated trading...');
    }, [plan, addLog]);

    const stopRun = useCallback(async () => {
        setPhase('idle');
        addLog('AI Analyst: Trading stopped.');
    }, [addLog]);

    return {
        focusType, allowedTypes, stake, takeProfit, stopLoss, autoRun, stakeMultiplierEnabled,
        phase, isBusy, plan, progress, logs, analyze, startRun, stopRun,
        setFocusType, toggleAllowedType, setStake, setTakeProfit, setStopLoss,
        setAutoRun, setStakeMultiplierEnabled,
    };
}
