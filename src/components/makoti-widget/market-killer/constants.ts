import type { MarketKillerConfig } from './types';

export const MAX_TICKS = 500;
export const MIN_TICKS = 15;
export const LS_CONFIG_KEY = 'mw_mk_config';
export const LS_LOGS_KEY = 'mw_mk_logs';
export const TRADE_COOLDOWN_MS = 1500;
export const VIRTUAL_RESOLVE_DELAY_MS = 1000;
export const BUY_TIMEOUT_MS = 8000;

export const DEFAULT_CONFIG: MarketKillerConfig = {
    stake: '0.35',
    martingale: '2',
    takeProfit: '10',
    stopLoss: '5',
    vhEnabled: false,
    vhThreshold: '1',
    maxDir: '3',
};
