/**
 * Funções para calcular indicadores técnicos
 * Usa a biblioteca technicalindicators
 */

import { RSI, SMA, MACD, EMA, ATR, BollingerBands } from 'technicalindicators';
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
  signalPeriod: number = 7
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
export function calculateATR(candles: Candle[], period: number = 13): number | null {
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
 * Calcula PMO (Price Momentum Oscillator)
 * PMO = EMA(ROC(period), smoothPeriod) * 10
 */
/**
 * Calcula PMO (Price Momentum Oscillator) conforme TradingView
 * TradingView padrão: length1=35, length2=20, signal=10
 * Fórmula: ROC(35) → EMA(20) → EMA(10) → PMO = (EMA20 - EMA10) × 10
 */
export function calculatePMO(
  closes: number[],
  rocPeriod: number = 35,
  emaFast: number = 20,
  emaSlow: number = 10
): number | null {
  // Precisa de candles suficientes: ROC period + EMA fast + EMA slow
  if (closes.length < rocPeriod + emaFast + emaSlow) {
    return null;
  }

  // 1. Calcular ROC (Rate of Change) com período length1 (35)
  const roc: number[] = [];
  for (let i = rocPeriod; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
    roc.push(change);
  }

  if (roc.length < emaFast) {
    return null;
  }

  // 2. Aplicar primeira EMA (length2 = 20) no ROC
  const emaFastValues = EMA.calculate({
    values: roc,
    period: emaFast,
  });

  if (emaFastValues.length < emaSlow) {
    return null;
  }

  // 3. Aplicar segunda EMA (signal length = 10) no resultado da primeira EMA
  const emaSlowValues = EMA.calculate({
    values: emaFastValues,
    period: emaSlow,
  });

  if (emaSlowValues.length === 0) {
    return null;
  }

  // 4. PMO = (EMA20 - EMA10) × 10
  const lastFast = emaFastValues[emaFastValues.length - 1];
  const lastSlow = emaSlowValues[emaSlowValues.length - 1];
  const pmo = (lastFast - lastSlow) * 10;

  return pmo;
}

/**
 * Calcula Bollinger Bands
 */
export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) {
    return null;
  }

  const bbValues = BollingerBands.calculate({
    values: closes,
    period: period,
    stdDev: stdDev,
  });

  if (bbValues.length === 0) {
    return null;
  }

  const last = bbValues[bbValues.length - 1];
  return {
    upper: last.upper || 0,
    middle: last.middle || 0,
    lower: last.lower || 0,
  };
}

/**
 * Calcula Donchian Channel (usando highest high e lowest low)
 * Retorna upper/lower (padrão) e também high/low (compatibilidade)
 */
export function calculateDonchianAt(
  candles: Candle[],
  period: number = 20,
  index: number = -1
): { upper: number; middle: number; lower: number; high: number; low: number } | null {
  if (candles.length < period) {
    return null;
  }

  // Se index é negativo, usa o último período
  const startIdx = index < 0 ? Math.max(0, candles.length + index - period + 1) : index;
  const endIdx = startIdx + period;

  if (endIdx > candles.length) {
    return null;
  }

  const slice = candles.slice(startIdx, endIdx);
  const upper = getHighestHigh(slice, period);
  const lower = getLowestLow(slice, period);
  const middle = (upper + lower) / 2;

  return { 
    upper, 
    middle, 
    lower,
    high: upper,  // Alias para compatibilidade
    low: lower    // Alias para compatibilidade
  };
}
