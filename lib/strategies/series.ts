/**
 * Séries de indicadores com a mesma semântica do pandas usado no backtest
 * (ewm adjust=False, rolling std com ddof=1). Cada função devolve um array
 * alinhado com a entrada, com NaN onde ainda não há dados.
 */

import type { Candle } from '../marketData';

export function sma(values: number[], n: number): number[] {
  const out = new Array(values.length).fill(NaN);
  for (let i = n - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += values[j];
    out[i] = sum / n; // NaN se a janela tiver NaN, como no pandas
  }
  return out;
}

export function rollingStd(values: number[], n: number): number[] {
  const out = new Array(values.length).fill(NaN);
  for (let i = n - 1; i < values.length; i++) {
    const w = values.slice(i - n + 1, i + 1);
    if (w.some((v) => Number.isNaN(v))) continue;
    const m = w.reduce((a, b) => a + b, 0) / n;
    out[i] = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  }
  return out;
}

/** EWM com adjust=False, a começar no primeiro valor válido */
function ewm(values: number[], alpha: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) {
      out[i] = prev;
      continue;
    }
    prev = Number.isNaN(prev) ? v : alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function ema(values: number[], span: number): number[] {
  return ewm(values, 2 / (span + 1));
}

/** RSI de Wilder (ewm alpha=1/n) */
export function rsi(closes: number[], n: number): number[] {
  const up = closes.map((c, i) => (i === 0 ? NaN : Math.max(c - closes[i - 1], 0)));
  const dn = closes.map((c, i) => (i === 0 ? NaN : Math.max(closes[i - 1] - c, 0)));
  const au = ewm(up, 1 / n);
  const ad = ewm(dn, 1 / n);
  return au.map((u, i) => (Number.isNaN(u) ? NaN : ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])));
}

/** ATR de Wilder (ewm alpha=1/n do true range) */
export function atr(candles: Candle[], n: number): number[] {
  const tr = candles.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close))
  );
  return ewm(tr, 1 / n);
}

/** Kaufman Adaptive Moving Average (ER n, rápida 2, lenta 30) */
export function kama(closes: number[], n = 30, fast = 2, slow = 30): number[] {
  const out = new Array(closes.length).fill(NaN);
  const fastSc = 2 / (fast + 1);
  const slowSc = 2 / (slow + 1);
  for (let i = n; i < closes.length; i++) {
    const change = Math.abs(closes[i] - closes[i - n]);
    let vol = 0;
    for (let j = i - n + 1; j <= i; j++) vol += Math.abs(closes[j] - closes[j - 1]);
    const er = vol === 0 ? 0 : change / vol;
    const sc = (er * (fastSc - slowSc) + slowSc) ** 2;
    out[i] = Number.isNaN(out[i - 1]) ? closes[i] : out[i - 1] + sc * (closes[i] - out[i - 1]);
  }
  return out;
}
