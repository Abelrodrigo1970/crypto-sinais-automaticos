/**
 * Scanner 10 (caça-rali) — mesma lógica de bot_scanner sinais/lib/scanner10RallyIgnition.ts e do replay em Python
 * (scratchpad s10/replay.py), corrido no fecho do dia UTC `day`:
 *   diário (últimas 200 velas até `day`): turnover do dia ≥ 1M; mínimo dos últimos 30 dias há ≤ 15 dias; preço ≤ 55% acima
 *   desse mínimo; washout (máx. 30d − mín. 30d) ÷ máx. 30d ≥ 12%; tipo "rise" (máx. 90d depois do mín. 90d) ou "bounce";
 *   rejeita bounce abaixo da EMA21 com RSI < 50;
 *   4h (velas abertas até ao fim de `day`): fecho > EMA21, EMA12 > EMA21, RSI ≥ 50; BTC no dia ≥ −1%.
 *   EMA com semente SMA no início da janela; RSI de Wilder (14).
 * Pontuação 0–31; lista = top 40 por pontuação (desempate RSI 4h).
 */
import type { Candle } from '../marketData';

const DAY = 86_400_000;

function emaLast(v: number[], p: number): number | null {
  if (v.length < p) return null;
  let prev = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const k = 2 / (p + 1);
  for (let i = p; i < v.length; i++) prev = v[i] * k + prev * (1 - k);
  return prev;
}

function rsiLast(c: number[], p = 14): number | null {
  if (c.length <= p) return null;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= p; i++) {
    const d = c[i] - c[i - 1];
    g += Math.max(d, 0);
    l += Math.max(-d, 0);
  }
  let ag = g / p;
  let al = l / p;
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + Math.max(d, 0)) / p;
    al = (al * (p - 1) + Math.max(-d, 0)) / p;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function smaLast(v: number[], p: number): number | null {
  return v.length < p ? null : v.slice(-p).reduce((a, b) => a + b, 0) / p;
}

/** Arredonda como o Python (round half to even não importa aqui: só se usa em contagens de dias) */
const roundDays = (ms: number) => Math.round(ms / DAY);

export interface Scanner10Item {
  symbol: string;
  price: number;
  score: number;
  kind: 'rise' | 'bounce';
  daysFromLow: number;
  pctFromLow: number;
  washPct: number;
  d1Rsi: number | null;
  h4Rsi: number;
  d1VolX: number | null;
}

/** Filtro diário; devolve null se a moeda não passa (não precisa das velas de 4h) */
export function dailyStage(daily: Candle[], day: number) {
  const d = daily.filter((c) => c.timestamp <= day).slice(-200);
  if (!d.length || d[d.length - 1].timestamp !== day) return null;
  const last = d[d.length - 1];
  const turnover = last.turnover ?? 0;
  if (turnover < 1e6 || d.length < 80) return null;
  const now = day + DAY - 60_000;
  const sw = d.filter((c) => c.timestamp >= now - 30 * DAY);
  const rg = d.filter((c) => c.timestamp >= now - 90 * DAY);
  if (sw.length < 20 || rg.length < 40) return null;
  let lo = Infinity, loT = 0, hiSw = -Infinity;
  for (const c of sw) {
    if (c.low < lo) { lo = c.low; loT = c.timestamp; }
    if (c.high > hiSw) hiSw = c.high;
  }
  const daysFromLow = Math.max(0, roundDays(day - loT));
  if (daysFromLow > 15) return null;
  const price = last.close;
  const pctFromLow = lo > 0 ? (price / lo - 1) * 100 : 0;
  if (pctFromLow > 55) return null;
  const washPct = hiSw > 0 ? ((hiSw - lo) / hiSw) * 100 : 0;
  if (washPct < 12) return null;
  const closes = d.map((c) => c.close);
  const vols = d.map((c) => c.turnover ?? 0);
  const e12 = emaLast(closes, 12), e21 = emaLast(closes, 21), rsi = rsiLast(closes), vma = smaLast(vols, 20);
  const above21 = e21 === null ? null : last.close > e21;
  let rhi = -Infinity, rhiT = 0, rlo = Infinity, rloT = 0;
  for (const c of rg) {
    if (c.high > rhi) { rhi = c.high; rhiT = c.timestamp; }
    if (c.low < rlo) { rlo = c.low; rloT = c.timestamp; }
  }
  const kind: 'rise' | 'bounce' = rhiT > rloT ? 'rise' : 'bounce';
  const fresh = roundDays(day - rloT) <= 21;
  if (kind === 'bounce' && above21 === false && rsi !== null && rsi < 50) return null;
  const d1VolX = vma ? Math.round((turnover / vma) * 100) / 100 : null;
  return {
    price, daysFromLow, pctFromLow, washPct, kind, fresh, rsi, d1VolX,
    d1Green: last.close > last.open,
    d1AboveEma12: e12 === null ? null : last.close > e12,
    above21,
  };
}

/** Filtro de 4h + pontuação; `btcDayPct` = variação diária da BTC no mesmo dia */
export function finalStage(
  symbol: string,
  ds: NonNullable<ReturnType<typeof dailyStage>>,
  h4All: Candle[],
  day: number,
  btcDayPct: number | null
): Scanner10Item | null {
  const now = day + DAY - 60_000;
  const h4 = h4All.filter((c) => c.timestamp <= now).slice(-200);
  if (h4.length < 60) return null;
  const c4 = h4.map((c) => c.close);
  const l4 = h4[h4.length - 1];
  const h12 = emaLast(c4, 12), h21 = emaLast(c4, 21), h50 = emaLast(c4, 50), hr = rsiLast(c4);
  if (h12 === null || h21 === null || hr === null) return null;
  const btcOk = btcDayPct === null || btcDayPct >= -1;
  if (!(l4.close > h21) || !(h12 > h21) || hr < 50 || !btcOk) return null;
  const rsi = ds.rsi;
  const h4AboveEma50 = h50 !== null && l4.close > h50;
  const score =
    (hr >= 60 ? 3 : hr >= 55 ? 2 : 1) +
    (h4AboveEma50 ? 2 : 0) +
    (ds.d1Green ? 2 : 0) +
    (ds.d1AboveEma12 ? 2 : 0) +
    (ds.above21 ? 2 : 0) +
    ((ds.d1VolX ?? 0) >= 2 ? 3 : 0) +
    (rsi !== null ? (rsi >= 45 && rsi <= 70 ? 2 : rsi > 70 && rsi <= 80 ? 1 : 0) : 0) +
    (ds.daysFromLow <= 9 ? 3 : ds.daysFromLow <= 15 ? 2 : 1) +
    (btcDayPct !== null && btcDayPct >= 0 ? 1 : 0) +
    (ds.kind === 'rise' ? 2 : 0) +
    (ds.fresh ? 3 : 0) +
    (ds.pctFromLow <= 15 ? 3 : ds.pctFromLow <= 25 ? 2 : ds.pctFromLow <= 40 ? 1 : 0) +
    (ds.washPct >= 25 ? 1 : 0);
  return {
    symbol, price: ds.price, score, kind: ds.kind, daysFromLow: ds.daysFromLow, pctFromLow: ds.pctFromLow,
    washPct: ds.washPct, d1Rsi: rsi, h4Rsi: Math.round(hr * 10) / 10, d1VolX: ds.d1VolX,
  };
}

/** Ordena como o scanner (pontuação, depois RSI 4h) e fica com o top 40 */
export function rankList(items: Scanner10Item[]): Scanner10Item[] {
  return [...items].sort((a, b) => b.score - a.score || b.h4Rsi - a.h4Rsi).slice(0, 40);
}

export interface PartialState {
  /** Frações por vender (1 = posição inteira) */
  left: number;
  /** Vendas já feitas */
  fills: Array<{ what: string; frac: number; price: number; at: number }>;
  /** Abertura (ms) da última vela de 4h já processada */
  lastH4: number;
  stopped: boolean;
}

/**
 * Aplica as velas de 4h fechadas desde a última processada: stop primeiro (pior caso, como no backtest),
 * depois os alvos por ordem. Preço de saída = nível, ou a abertura se a vela abriu já para lá dele.
 */
export function applyBars(
  st: PartialState,
  entry: number,
  bars: Candle[],
  targets: Array<{ pct: number; frac: number }>,
  stopPct: number
): PartialState {
  const s: PartialState = { ...st, fills: [...st.fills] };
  for (const b of bars) {
    if (b.timestamp <= s.lastH4 || s.left <= 1e-9) continue;
    s.lastH4 = b.timestamp;
    const stopPx = entry * (1 - stopPct / 100);
    if (b.low <= stopPx) {
      s.fills.push({ what: `stop −${stopPct}%`, frac: s.left, price: Math.min(b.open, stopPx), at: b.timestamp });
      s.left = 0;
      s.stopped = true;
      break;
    }
    for (const t of targets) {
      const label = `+${t.pct}%`;
      if (s.fills.some((f) => f.what === label)) continue;
      const px = entry * (1 + t.pct / 100);
      if (b.high >= px) {
        s.fills.push({ what: label, frac: t.frac, price: Math.max(b.open, px), at: b.timestamp });
        s.left = Math.max(0, s.left - t.frac);
      }
    }
  }
  return s;
}

/** Resultado em % (sem custos): vendas feitas + resto ao preço `price` */
export function blendedPct(st: PartialState, entry: number, price: number): number {
  const sold = st.fills.reduce((a, f) => a + f.frac * (f.price / entry - 1), 0);
  return (sold + st.left * (price / entry - 1)) * 100;
}
