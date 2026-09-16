export type ContractType = 'CALL' | 'PUT' | 'DIGITOVER' | 'DIGITUNDER';

export interface DigitAnalysis {
    freq: number[];
    recentFreq: number[];
    dominantDigit: number;
    rareDigit: number;
    streakLen: number;
    streakDigit: number;
    reversalSignal: boolean;
}

export interface TradeSignal {
    contract_type: ContractType;
    barrier: string;
    confidence: number;
    reason: string;
    details: string;
}

const strategyOutcomes: Record<string, { wins: number; losses: number }> = {};

export function recordOutcome(strategyName: string, won: boolean) {
    if (!strategyOutcomes[strategyName]) strategyOutcomes[strategyName] = { wins: 0, losses: 0 };
    if (won) strategyOutcomes[strategyName].wins++;
    else strategyOutcomes[strategyName].losses++;
}

function calcRSI(prices: number[], period = 7): number {
    if (prices.length < period + 1) return 50;
    const slice = prices.slice(-(period * 4 + 1));
    if (slice.length < 2) return 50;
    const changes = slice.slice(1).map((p, i) => p - slice[i]);
    const gains = changes.map(c => Math.max(0, c));
    const losses = changes.map(c => Math.max(0, -c));
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcEMA(prices: number[], period: number): number[] {
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

function calcMACDHistogram(prices: number[]): { hist: number; prevHist: number } {
    if (prices.length < 28) return { hist: 0, prevHist: 0 };
    const ema12 = calcEMA(prices, 12);
    const ema26 = calcEMA(prices, 26);
    const offset = ema12.length - ema26.length;
    const macdLine: number[] = ema26.map((v, i) => ema12[i + offset] - v);
    if (macdLine.length < 9) return { hist: macdLine.at(-1) ?? 0, prevHist: 0 };
    const signal = calcEMA(macdLine, 9);
    const hist = macdLine.at(-1)! - signal.at(-1)!;
    const prevHist = macdLine.at(-2)! - signal.at(-2)!;
    return { hist, prevHist };
}

export function analyzeSignals(
    ticks: number[],
    prices: number[],
    contractTypes: ContractType[],
    digitFreq?: number[],
    digitAnalysis?: DigitAnalysis,
): TradeSignal | null {
    if (prices.length < 5) return null;

    const d1 = prices[prices.length - 1] - prices[prices.length - 2];
    const d2 = prices[prices.length - 2] - prices[prices.length - 3];
    const d3 = prices[prices.length - 3] - prices[prices.length - 4];
    if (d1 === 0) return null;

    const lastDigit = ticks[ticks.length - 1];

    let streakLen = 0;
    for (let i = ticks.length - 1; i > 0; i--) {
        if (ticks[i] === ticks[i - 1]) streakLen++;
        else break;
    }

    const rsi = calcRSI(prices, 3);
    const macd = calcMACDHistogram(prices);
    const macdBullish = macd.hist > 0 && macd.hist > macd.prevHist;

    let bestConfidence = 0;
    let bestSignal: TradeSignal | null = null;

    if (contractTypes.some(c => c === 'CALL' || c === 'PUT')) {
        if (d1 > 0 && d2 > 0 && d3 > 0 && rsi < 70 && macdBullish) {
            const conf = Math.min(92, 75 + Math.abs(d1 * 5));
            bestSignal = { contract_type: 'CALL', barrier: '', confidence: conf, reason: 'Momentum RISE', details: 'Strategies: momentum(macd)' };
            bestConfidence = conf;
        } else if (d1 < 0 && d2 < 0 && d3 < 0 && rsi > 30 && !macdBullish) {
            const conf = Math.min(92, 75 + Math.abs(d1 * 5));
            bestSignal = { contract_type: 'PUT', barrier: '', confidence: conf, reason: 'Momentum FALL', details: 'Strategies: momentum(macd)' };
            bestConfidence = conf;
        }
    }

    if (contractTypes.some(c => c === 'DIGITOVER' || c === 'DIGITUNDER')) {
        // Base: last digit scoring
        let underScore = 100 - (lastDigit * 10);
        let overScore = lastDigit * 10;

        // IMPROVEMENT: Losing digit frequency check
        // Threshold scales with number of losing digits (fewer digits = lower threshold)
        if (digitFreq && digitFreq.length === 10) {
            const losingDigitsOver = digitFreq.slice(0, lastDigit + 1).reduce((a, b) => a + b, 0);
            const losingDigitsUnder = digitFreq.slice(lastDigit).reduce((a, b) => a + b, 0);
            const numLosingOver = lastDigit + 1;
            const numLosingUnder = 10 - lastDigit;
            const expectedOver = numLosingOver * 10;
            const expectedUnder = numLosingUnder * 10;
            const threshOver = Math.min(65, expectedOver * 1.3);
            const threshUnder = Math.min(65, expectedUnder * 1.3);

            if (losingDigitsOver > threshOver) {
                overScore -= 20;
            }
            if (losingDigitsUnder > threshUnder) {
                underScore -= 20;
            }
            if (losingDigitsOver > threshOver + 10 && overScore > underScore) {
                return null;
            }
            if (losingDigitsUnder > threshUnder + 10 && underScore > overScore) {
                return null;
            }
        }

        // IMPROVEMENT 2: Reverse streak logic — long streaks favor UNDER (reversal bias)
        // Short streaks (1-2) = neutral, long streaks (3+) = boost UNDER
        if (streakLen >= 3) {
            underScore += streakLen * 4;
            overScore -= streakLen * 2;
        } else if (streakLen === 1) {
            overScore += 2;
            underScore += 2;
        }

        // IMPROVEMENT 1: Use digit frequency — rare digit appearing = OVER, dominant = UNDER
        if (digitFreq && digitFreq.length === 10) {
            const avgFreq = 10;
            const digitPct = digitFreq[lastDigit] ?? avgFreq;
            if (digitPct < avgFreq * 0.7) {
                overScore += (avgFreq - digitPct) * 1.5;
            } else if (digitPct > avgFreq * 1.3) {
                underScore += (digitPct - avgFreq) * 1.5;
            }
        }

        // IMPROVEMENT 6: Use analyzeDigitPsychology data
        if (digitAnalysis) {
            // Reversal signal: dominant digit on long streak → boost UNDER (reversal likely)
            if (digitAnalysis.reversalSignal) {
                underScore += 8;
                overScore -= 5;
            }
            // Current digit IS the dominant digit → overrepresented, boost UNDER
            if (lastDigit === digitAnalysis.dominantDigit) {
                underScore += 4;
            }
            // Current digit IS the rare digit → underrepresented, boost OVER
            if (lastDigit === digitAnalysis.rareDigit) {
                overScore += 4;
            }
            // Recent frequency diverging from overall → digit is "heating up", boost UNDER
            if (digitAnalysis.recentFreq.length === 10 && digitAnalysis.freq.length === 10) {
                const recentPct = digitAnalysis.recentFreq[lastDigit] ?? 10;
                const overallPct = digitAnalysis.freq[lastDigit] ?? 10;
                if (recentPct > overallPct * 1.5) {
                    underScore += 5;
                } else if (recentPct < overallPct * 0.5) {
                    overScore += 5;
                }
            }
        }

        // RSI confirmation
        if (lastDigit >= 7) underScore += 3;
        if (lastDigit <= 3) overScore += 3;

        if (underScore > overScore && underScore > 55) {
            const conf = Math.min(90, underScore);
            if (conf > bestConfidence) {
                const psych = digitAnalysis ? ` | dom:${digitAnalysis.dominantDigit} rare:${digitAnalysis.rareDigit}${digitAnalysis.reversalSignal ? ' REV' : ''}` : '';
                bestSignal = { contract_type: 'DIGITUNDER', barrier: String(lastDigit), confidence: conf, reason: `DIGITUNDER ${lastDigit}`, details: `Digit psychology: ${lastDigit}×${streakLen}${psych}` };
            }
        } else if (overScore > 55) {
            const conf = Math.min(90, overScore);
            if (conf > bestConfidence) {
                const psych = digitAnalysis ? ` | dom:${digitAnalysis.dominantDigit} rare:${digitAnalysis.rareDigit}${digitAnalysis.reversalSignal ? ' REV' : ''}` : '';
                bestSignal = { contract_type: 'DIGITOVER', barrier: String(lastDigit), confidence: conf, reason: `DIGITOVER ${lastDigit}`, details: `Digit psychology: ${lastDigit}×${streakLen}${psych}` };
            }
        }
    }

    return bestSignal;
}

export function findBestDuration(prices: number[], _direction: 'CALL' | 'PUT'): number {
    if (prices.length < 5) return 1;
    const vol = Math.abs(prices[prices.length - 1] - prices[prices.length - 3]);
    if (vol < 2) return 3;
    if (vol < 5) return 2;
    return 1;
}
