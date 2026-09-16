export type TradeDirection = 'CALL' | 'PUT';
export type TickDir = 'up' | 'down' | null;
export type LogType = 'win' | 'loss' | 'info' | 'trade' | 'trigger' | 'recovery';

export interface SymState {
    ticks: number[];
    prices: number[];
    lastSignal: string;
    wins: number;
    losses: number;
    ready: boolean;
}

export interface LogEntry {
    time: string;
    msg: string;
    type: LogType;
}

export interface SymbolDisplay {
    label: string;
    lastSignal: string;
    wins: number;
    losses: number;
    dir: TickDir;
    dirCount: number;
    stake: number;
    digit: number | null;
}

export interface MarketKillerConfig {
    stake: string;
    martingale: string;
    takeProfit: string;
    stopLoss: string;
    vhEnabled: boolean;
    vhThreshold: string;
    maxDir: string;
}

export interface ContractEntry {
    symbol: string;
    stake: number;
    strategyNames: string[];
    transactionId?: string;
}

export interface VirtualTrade {
    symbol: string;
    entryPrice: number;
    direction: TradeDirection;
    stake: number;
    startTime: number;
    buyId: string;
    ticksElapsed: number;
    resolved: boolean;
}

export interface VhState {
    enabled: boolean;
    threshold: number;
    isVirtual: boolean;
    lossCount: number;
}

export interface RecoveryState {
    active: boolean;
    pending: number;
    stake: number;
    martingale: number;
    vhThreshold: number;
}
