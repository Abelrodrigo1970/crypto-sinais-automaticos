/**
 * Funções para calcular indicadores técnicos
 * Usa a biblioteca technicalindicators
 */

import { RSI, SMA, MACD, EMA, ATR } from 'technicalindicators';
import type { Candle } from './marketData';

/**
 * Calcula o RSI (Relative Strength Index)
 */
export function calculateRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) {
    return null;
  }

  const rsiValues = RSI.calculate({
    values: closes,
    period: period,
  });

  return rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
}

/**
 * Calcula Média Móvel Simples (SMA)
 */
export function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }

  const smaValues = SMA.calculate({
    values: values,
    period: period,
  });

  return smaValues.length > 0 ? smaValues[smaValues.length - 1] : null;
}

/**
 * Calcula MACD
 */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < slowPeriod + signalPeriod) {
    return null;
  }

  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: fastPeriod,
    slowPeriod: slowPeriod,
    signalPeriod: signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  if (macdValues.length === 0) {
    return null;
  }

  const last = macdValues[macdValues.length - 1];
  return {
    macd: last.MACD || 0,
    signal: last.signal || 0,
    histogram: last.histogram || 0,
  };
}

/**
 * Extrai array de preços de fechamento de candles
 */
export function getCloses(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/**
 * Calcula o preço mais alto em um período
 */
export function getHighestHigh(candles: Candle[], period: number): number {
  const recent = candles.slice(-period);
  return Math.max(...recent.map((c) => c.high));
}

/**
 * Calcula o preço mais baixo em um período
 */
export function getLowestLow(candles: Candle[], period: number): number {
  const recent = candles.slice(-period);
  return Math.min(...recent.map((c) => c.low));
}

/**
 * Calcula EMA (Exponential Moving Average)
 */
export function calculateEMA(values: number[], period: number): number[] | null {
  if (values.length < period) {
    return null;
  }

  const emaValues = EMA.calculate({
    values: values,
    period: period,
  });

  return emaValues.length > 0 ? emaValues : null;
}

/**
 * Calcula ATR (Average True Range)
 */
export function calculateATR(
  candles: Candle[],
  period: number = 14
): number | null {
  if (candles.length < period + 1) {
    return null;
  }

  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);

  const atrValues = ATR.calculate({
    high: high,
    low: low,
    close: close,
    period: period,
  });

  return atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;
}

/**
 * Calcula Volume Moving Average
 */
export function calculateVolumeMA(volumes: number[], period: number): number | null {
  if (volumes.length < period) {
    return null;
  }

  const smaValues = SMA.calculate({
    values: volumes,
    period: period,
  });

  return smaValues.length > 0 ? smaValues[smaValues.length - 1] : null;
}

/**
 * Extrai array de volumes de candles
 */
export function getVolumes(candles: Candle[]): number[] {
  return candles.map((c) => c.volume);
}

/**
 * Calcula Bollinger Bands
 * @param closes Array de preços de fechamento
 * @param period Período para SMA (padrão: 20)
 * @param stdDev Desvio padrão (padrão: 2)
 * @returns { upper, middle, lower } ou null se dados insuficientes
 */
export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) {
    return null;
  }

  // Calcular SMA (middle band)
  const smaValues = SMA.calculate({
    values: closes,
    period: period,
  });

  if (smaValues.length === 0) {
    return null;
  }

  const middle = smaValues[smaValues.length - 1];
  const recentCloses = closes.slice(-period);

  // Calcular desvio padrão
  const mean = middle;
  const variance =
    recentCloses.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) /
    period;
  const standardDeviation = Math.sqrt(variance);

  const upper = middle + stdDev * standardDeviation;
  const lower = middle - stdDev * standardDeviation;

  return { upper, middle, lower };
}

/**
 * Calcula Donchian Channel (High e Low de um período)
 * @param candles Array de candles
 * @param period Período (padrão: 20)
 * @returns { high, low } ou null se dados insuficientes
 */
export function calculateDonchian(
  candles: Candle[],
  period: number = 20
): { high: number; low: number } | null {
  if (candles.length < period) {
    return null;
  }

  const recent = candles.slice(-period);
  const high = Math.max(...recent.map((c) => c.high));
  const low = Math.min(...recent.map((c) => c.low));

  return { high, low };
}

/**
 * Calcula Donchian usando índice i-1 (sem lookahead)
 * @param candles Array de candles até o índice i
 * @param period Período
 * @param index Índice atual (usa dados até index-1)
 * @returns { high, low } ou null se dados insuficientes
 */
export function calculateDonchianAt(
  candles: Candle[],
  period: number,
  index: number
): { high: number; low: number } | null {
  if (index < period || index > candles.length) {
    return null;
  }

  // Usa candles de [index - period] até [index - 1] (sem incluir index)
  const start = Math.max(0, index - period);
  const end = index;
  const slice = candles.slice(start, end);

  if (slice.length < period) {
    return null;
  }

  const high = Math.max(...slice.map((c) => c.high));
  const low = Math.min(...slice.map((c) => c.low));

  return { high, low };
}

/**
 * Calcula PMO (Price Momentum Oscillator)
 * PMO = EMA(ROC, fastPeriod) onde ROC = Rate of Change
 * @param closes Array de preços de fechamento
 * @param rocPeriod Período para ROC (padrão: 10)
 * @param fastPeriod Período para EMA rápida do ROC (padrão: 5)
 * @param slowPeriod Período para EMA lenta do ROC (padrão: 35) - não usado no cálculo básico, mas mantido para compatibilidade
 * @returns { pmo: number } ou null se dados insuficientes
 */
export function calculatePMO(
  closes: number[],
  rocPeriod: number = 10,
  fastPeriod: number = 5,
  slowPeriod: number = 35
): { pmo: number } | null {
  // Precisa de pelo menos rocPeriod + fastPeriod candles
  if (closes.length < rocPeriod + fastPeriod + 1) {
    return null;
  }

  // Calcular ROC (Rate of Change)
  const roc: number[] = [];
  for (let i = rocPeriod; i < closes.length; i++) {
    const rocValue = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
    roc.push(rocValue);
  }

  if (roc.length < fastPeriod) {
    return null;
  }

  // Calcular PMO = EMA(ROC, fastPeriod)
  const emaValues = EMA.calculate({
    values: roc,
    period: fastPeriod,
  });

  if (emaValues.length === 0) {
    return null;
  }

  const pmo = emaValues[emaValues.length - 1];

  return { pmo };
}


