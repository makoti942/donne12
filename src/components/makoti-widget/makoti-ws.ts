import { getAppId, getSocketURL } from '@/components/shared';
import { onNewSystemMessage, isNewLoggedIn } from '@/auth/NewDerivAuth';

export const ALL_SYMBOLS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
];

export const SYMBOL_LABELS: Record<string, string> = {
    R_10: 'Volatility 10', R_25: 'Volatility 25', R_50: 'Volatility 50', R_75: 'Volatility 75', R_100: 'Volatility 100',
    '1HZ10V': 'Volatility 10 (1s)', '1HZ25V': 'Volatility 25 (1s)', '1HZ50V': 'Volatility 50 (1s)',
    '1HZ75V': 'Volatility 75 (1s)', '1HZ100V': 'Volatility 100 (1s)',
};

export const PIP_SIZES: Record<string, number> = {
    R_100: 2, R_75: 4, R_50: 4, R_25: 3, R_10: 3,
    '1HZ100V': 2, '1HZ75V': 2, '1HZ50V': 2, '1HZ25V': 2, '1HZ10V': 2,
};

export function getToken(): string | null {
    try {
        const active_loginid = localStorage.getItem('active_loginid');
        if (!active_loginid) return null;
        const isRealToken = (v: string) => v && !/^[A-Z]{2,3}\d+$/.test(v);
        const ca = localStorage.getItem('client.accounts');
        if (ca) { const t = JSON.parse(ca)[active_loginid]?.token; if (t && isRealToken(t)) return t; }
        const al = localStorage.getItem('accountsList');
        if (al) { const t = JSON.parse(al)[active_loginid]; if (t && isRealToken(t)) return t; }
        const authToken = localStorage.getItem('authToken');
        if (authToken && isRealToken(authToken)) return authToken;
        const tokenKey = `token_${active_loginid}`;
        const tokenVal = localStorage.getItem(tokenKey);
        if (tokenVal && isRealToken(tokenVal)) return tokenVal;
    } catch (_) {}
    return null;
}

export type MakotiWS = {
    send: (msg: object) => void;
    close: () => void;
    isOpen: () => boolean;
};

export function openMakotiWS(
    onMessage: (data: any) => void,
    onReady: () => void,
    onClose: () => void,
    options?: { skipAuth?: boolean },
): MakotiWS {
    let unsub: (() => void) | null = null;
    let stopped = false;
    let readyFired = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const subscribe = () => {
        unsub = onNewSystemMessage((event) => {
            try {
                const data = JSON.parse(event.data);
                onMessage(data);
            } catch (_) {}
        });
    };

    const sendFn = (msg: object) => {
        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            window._newSystemWS.send(JSON.stringify(msg));
        }
    };

    const closeFn = () => {
        stopped = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (unsub) unsub();
    };

    const isOpenFn = () => window._newSystemWS?.readyState === WebSocket.OPEN;

    // If already open, just subscribe — caller sends requests directly
    if (window._newSystemWS?.readyState === WebSocket.OPEN) {
        subscribe();
        readyFired = true;
        setTimeout(onReady, 0);
        return { send: sendFn, close: closeFn, isOpen: isOpenFn };
    }

    subscribe();

    const poll = () => {
        if (stopped || readyFired) return;
        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            readyFired = true;
            onReady();
            return;
        }
        // If WS doesn't exist yet, try to trigger creation
        if (!window._newSystemWS) {
            import('@/external/bot-skeleton/services/api/appId').then(mod => {
                mod.generateDerivApiInstance().catch(() => {});
            }).catch(() => {});
        }
        pollTimer = setTimeout(poll, 500);
    };
    poll();

    return { send: sendFn, close: closeFn, isOpen: isOpenFn };
}

export function calcEMA(prices: number[], period: number): number[] {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [ema];
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
        result.push(ema);
    }
    return result;
}

export function getDigitPcts(ticks: number[], count = 100): number[] {
    const arr = ticks.slice(-count);
    const total = arr.length || 1;
    const c = Array(10).fill(0);
    arr.forEach(d => { if (d >= 0 && d <= 9) c[d]++; });
    return c.map(v => (v / total) * 100);
}
