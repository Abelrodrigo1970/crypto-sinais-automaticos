/**
 * Pullback em moeda forte — cálculo com a mesma semântica do backtest em pandas:
 *   lr   = log(C_t / C_{t-1})                                   por moeda
 *   mkt  = média de lr nas moedas com dados                      (índice igual do universo)
 *   beta = cov(lr, mkt) / var(mkt), janela 30 dias (mín. 15), da barra anterior
 *   res  = lr − beta × mkt                                       (movimento próprio)
 *   z7   = Σ res (7 dias) / (std(res, 30 dias, mín. 15) × √7)
 *   RSI3 = RSI de Wilder com ewm(alpha=1/3, adjust=True), como o pandas por omissão
 * Sinal no fecho do dia t: z7[t−1] > zMin e RSI3[t] < rsiEntry. Saída no fecho em que RSI3 > rsiExit.
 */

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** EWM com adjust=True (pandas por omissão), ignorando NaN iniciais */
function ewmAdjusted(values: number[], alpha: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let num = 0;
  let den = 0;
  let started = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) {
      if (started) {
        num *= 1 - alpha;
        den *= 1 - alpha;
        out[i] = num / den;
      }
      continue;
    }
    started = true;
    num = v + (1 - alpha) * num;
    den = 1 + (1 - alpha) * den;
    out[i] = num / den;
  }
  return out;
}

export function rsiPandas(closes: number[], n: number): number[] {
  const up = closes.map((c, i) => (i === 0 || Number.isNaN(c) || Number.isNaN(closes[i - 1]) ? NaN : Math.max(c - closes[i - 1], 0)));
  const dn = closes.map((c, i) => (i === 0 || Number.isNaN(c) || Number.isNaN(closes[i - 1]) ? NaN : Math.max(closes[i - 1] - c, 0)));
  const au = ewmAdjusted(up, 1 / n);
  const ad = ewmAdjusted(dn, 1 / n);
  return au.map((u, i) => (Number.isNaN(u) || Number.isNaN(ad[i]) ? NaN : ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])));
}

export interface PullbackInput {
  /** Fechos diários por símbolo: [abertura da vela (ms), fecho], mais antigo primeiro */
  closes: Record<string, Array<[number, number]>>;
  /** Símbolos do universo (entram na média do mercado) */
  universe: string[];
  /** Última barra a usar (abertura, ms) */
  lastBar: number;
  zDays?: number;
  window?: number;
}

export interface PullbackState {
  /** z7 na barra anterior à última (o que o sinal usa) */
  zPrev: Record<string, number>;
  /** RSI(3) na última barra */
  rsi3: Record<string, number>;
  /** Fecho da última barra */
  close: Record<string, number>;
}

export function computePullback({ closes, universe, lastBar, zDays = 7, window = 30 }: PullbackInput): PullbackState {
  const symbols = Object.keys(closes);
  const times = Array.from(new Set(symbols.flatMap((s) => closes[s].map(([t]) => t))))
    .filter((t) => t <= lastBar)
    .sort((a, b) => a - b);
  const T = times.length;
  const pos = new Map(times.map((t, i) => [t, i]));
  const minP = Math.floor(window / 2);
  const C: Record<string, number[]> = {};
  for (const s of symbols) {
    const c = new Array(T).fill(NaN);
    for (const [t, v] of closes[s]) {
      const i = pos.get(t);
      if (i !== undefined && v > 0) c[i] = v;
    }
    C[s] = c;
  }
  const inU = new Set(universe);
  const lr: Record<string, number[]> = {};
  for (const s of symbols) {
    const c = C[s];
    lr[s] = c.map((v, i) => (i === 0 || Number.isNaN(v) || Number.isNaN(c[i - 1]) ? NaN : Math.log(v / c[i - 1])));
  }
  const mkt = new Array(T).fill(NaN);
  for (let i = 0; i < T; i++) {
    const xs = symbols.filter((s) => inU.has(s)).map((s) => lr[s][i]).filter((v) => !Number.isNaN(v));
    if (xs.length) mkt[i] = mean(xs);
  }
  const state: PullbackState = { zPrev: {}, rsi3: {}, close: {} };
  for (const s of symbols) {
    const x = lr[s];
    const beta = new Array(T).fill(NaN);
    for (let i = 0; i < T; i++) {
      const lo = Math.max(0, i - window + 1);
      const px: number[] = [];
      const pm: number[] = [];
      const mAll: number[] = [];
      for (let j = lo; j <= i; j++) {
        if (!Number.isNaN(mkt[j])) mAll.push(mkt[j]);
        if (!Number.isNaN(x[j]) && !Number.isNaN(mkt[j])) {
          px.push(x[j]);
          pm.push(mkt[j]);
        }
      }
      if (px.length < minP || mAll.length < minP) continue;
      const mx = mean(px);
      const mm = mean(pm);
      const cov = px.reduce((a, v, k) => a + (v - mx) * (pm[k] - mm), 0) / (px.length - 1);
      const ma = mean(mAll);
      const varM = mAll.reduce((a, v) => a + (v - ma) ** 2, 0) / (mAll.length - 1);
      if (varM > 0) beta[i] = cov / varM;
    }
    const res = x.map((v, i) => (i === 0 || Number.isNaN(v) || Number.isNaN(beta[i - 1]) ? NaN : v - beta[i - 1] * mkt[i]));
    const zAt = (i: number): number => {
      if (i < zDays - 1) return NaN;
      const w = res.slice(i - zDays + 1, i + 1);
      if (w.some((v) => Number.isNaN(v))) return NaN;
      const sdw = res.slice(Math.max(0, i - window + 1), i + 1).filter((v) => !Number.isNaN(v));
      if (sdw.length < minP) return NaN;
      const m = mean(sdw);
      const sd = Math.sqrt(sdw.reduce((a, v) => a + (v - m) ** 2, 0) / (sdw.length - 1));
      return sd > 0 ? w.reduce((a, b) => a + b, 0) / (sd * Math.sqrt(zDays)) : NaN;
    };
    const last = T - 1;
    const r = rsiPandas(C[s], 3);
    if (!Number.isNaN(C[s][last])) {
      state.close[s] = C[s][last];
      if (!Number.isNaN(r[last])) state.rsi3[s] = r[last];
      const z = zAt(last - 1);
      if (!Number.isNaN(z)) state.zPrev[s] = z;
    }
  }
  return state;
}
