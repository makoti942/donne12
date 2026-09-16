function convertToNewFormat(data) {
    if (!data || typeof data !== 'object') return data
    const out = Array.isArray(data) ? data.map(convertToNewFormat) : { ...data }

    if (out.proposal === 1 && out.symbol) {
        out.underlying_symbol = out.symbol
        delete out.symbol
    }

    if ('buy' in out) {
        out.buy = String(out.buy)
    }

    if (out.parameters && typeof out.parameters === 'object') {
        out.parameters = { ...out.parameters }
        if ('symbol' in out.parameters) {
            out.parameters.underlying_symbol = out.parameters.symbol
            delete out.parameters.symbol
        }
    }

    return out
}

export function onNewSystemMessage(callback) {
    if (typeof window === 'undefined') return () => {};
    const handler = (event) => { try { callback(event.detail); } catch (_) {} };
    window.addEventListener('newSystemMessage', handler);
    return () => window.removeEventListener('newSystemMessage', handler);
}

export function isNewLoggedIn() {
    try {
        const activeLoginId = localStorage.getItem('active_loginid');
        if (activeLoginId) return true;
        const acc = JSON.parse(localStorage.getItem('client.accounts') || '{}');
        const ids = JSON.parse(localStorage.getItem('accountsList') || '{}');
        return Object.keys(acc).length > 0 || Object.keys(ids).length > 0;
    } catch { return false; }
}

export async function sendViaNewSystemWithPromise(msg) {
    return new Promise((resolve, reject) => {
        if (!window._newSystemWS || window._newSystemWS.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not open'));
            return;
        }
        const msgType = Object.keys(msg).find(k => k !== 'passthrough' && k !== 'req_id');
        const reqId = msg.req_id || Date.now();
        const toSend = { ...convertToNewFormat(msg), req_id: reqId };
        const handler = (event) => {
            try {
                const data = JSON.parse(event.detail.data);
                if (data.req_id === reqId || data.msg_type === msgType) {
                    window.removeEventListener('newSystemMessage', handler);
                    if (data.error) reject(data);
                    else resolve(data);
                }
            } catch (_) {}
        };
        window.addEventListener('newSystemMessage', handler);
        window._newSystemWS.send(JSON.stringify(toSend));
        setTimeout(() => { window.removeEventListener('newSystemMessage', handler); reject(new Error('Timeout')); }, 30000);
    });
}

export function sendViaNewSystem(data) {
    if (window._newSystemWS?.readyState === WebSocket.OPEN) {
        window._newSystemWS.send(JSON.stringify(convertToNewFormat(data)))
        return true
    }
    return false
}
