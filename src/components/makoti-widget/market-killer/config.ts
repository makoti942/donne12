import { DEFAULT_CONFIG, LS_CONFIG_KEY } from './constants';
import type { MarketKillerConfig } from './types';

export function loadConfig(): MarketKillerConfig {
    try {
        const raw = localStorage.getItem(LS_CONFIG_KEY);
        return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
    } catch {
        return DEFAULT_CONFIG;
    }
}

export function saveConfig(cfg: MarketKillerConfig): void {
    try {
        localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(cfg));
    } catch {}
}
