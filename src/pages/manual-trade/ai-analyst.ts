export type AiFocus = 'auto' | 'matches-differs' | 'over-under' | 'even-odd';

export interface AiPlan {
    market: string;
    contract_type: string;
    barrier_digit: number | null;
    duration_ticks: number;
    stake: number;
    payout: number;
    profit: number;
    confidence: number;
}

export const VOLATILITY_LIST = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
];

export const volPipSize: Record<string, number> = {
    R_10: 3, R_25: 3, R_50: 4, R_75: 4, R_100: 2,
    '1HZ10V': 2, '1HZ25V': 2, '1HZ50V': 2, '1HZ75V': 2, '1HZ100V': 2,
};

export type VolatilitySymbol = typeof VOLATILITY_LIST[number];

export interface SymbolStats {
    symbol: string;
    label: string;
    digits: number[];
    pcts: number[];
}

export function computeSymbolStats(symbol: string, digits: number[]): SymbolStats {
    const counts = Array(10).fill(0);
    digits.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    const total = digits.length || 1;
    return { symbol, label: symbol, digits, pcts: counts.map(c => (c / total) * 100) };
}

export async function requestAiPlan(_stats: SymbolStats[], _focus: AiFocus): Promise<AiPlan | null> {
    return null;
}

export async function backtestPlan(_plan: AiPlan, _digits: number[]): Promise<{ winRate: number; pnl: number }> {
    return { winRate: 0, pnl: 0 };
}
