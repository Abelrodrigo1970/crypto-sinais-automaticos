/**
 * Cálculo do momentum de resíduos, com a mesma semântica do backtest em pandas
 * (rolling com min_periods, std ddof=1, beta desfasado uma barra).
 *
 *   lr      = log(C_t / C_{t-1})                         por moeda
 *   mkt     = média de lr nas moedas com dados              (índice igual)
 *   beta    = cov(lr, mkt) / var(mkt), janela betaBars (mín. metade), da barra anterior
 *   res     = lr − beta × mkt                               (movimento próprio)
 *   z       = Σ res (últimas lookbackBars) / (std(res, betaBars) × √lookbackBars)
 */

export interface ResMomInput {
  /** Fechos por símbolo: [timestamp de abertura da vela, fecho], mais antigo primeiro */
  closes: Record<string, Array<[number, number]>>;
  /** Última barra a usar (abertura, ms); barras posteriores são ignoradas */
  decisionBar: number;
  lookbackBars: number;
  betaBars: number;
}

export interface ResMomResult {
  /** z por símbolo na barra de decisão (só os que têm valor) */
  z: Record<string, number>;
  /** Barras usadas na grelha comum */
  bars: number;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function computeResMom({ closes, decisionBar, lookbackBars, betaBars }: ResMomInput): ResMomResult {
  const symbols = Object.keys(closes);
  const times = Array.from(new Set(symbols.flatMap((s) => closes[s].map(([t]) => t))))
    .filter((t) => t <= decisionBar)
    .sort((a, b) => a - b);
  const T = times.length;
  const pos = new Map(times.map((t, i) => [t, i]));
  const minP = Math.floor(betaBars / 2);

  // lr[s][i]
  const lr: Record<string, number[]> = {};
  for (const s of symbols) {
    const c = new Array(T).fill(NaN);
    for (const [t, v] of closes[s]) {
      const i = pos.get(t);
      if (i !== undefined && v > 0) c[i] = v;
    }
    lr[s] = c.map((v, i) => (i === 0 || Number.isNaN(v) || Number.isNaN(c[i - 1]) ? NaN : Math.log(v / c[i - 1])));
  }

  const mkt = new Array(T).fill(NaN);
  for (let i = 0; i < T; i++) {
    const xs = symbols.map((s) => lr[s][i]).filter((v) => !Number.isNaN(v));
    if (xs.length) mkt[i] = mean(xs);
  }

  const z: Record<string, number> = {};
  for (const s of symbols) {
    const x = lr[s];
    // beta em cada barra (janela a terminar nessa barra); usa-se a da barra anterior
    const beta = new Array(T).fill(NaN);
    for (let i = 0; i < T; i++) {
      const lo = Math.max(0, i - betaBars + 1);
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

    const i = T - 1;
    if (i < lookbackBars) continue;
    const win = res.slice(i - lookbackBars + 1, i + 1);
    if (win.some((v) => Number.isNaN(v))) continue; // rolling(lookback).sum exige a janela completa
    const sdWin = res.slice(Math.max(0, i - betaBars + 1), i + 1).filter((v) => !Number.isNaN(v));
    if (sdWin.length < minP) continue;
    const m = mean(sdWin);
    const sd = Math.sqrt(sdWin.reduce((a, v) => a + (v - m) ** 2, 0) / (sdWin.length - 1));
    if (!(sd > 0)) continue;
    z[s] = win.reduce((a, b) => a + b, 0) / (sd * Math.sqrt(lookbackBars));
  }
  return { z, bars: T };
}

export interface TargetPosition {
  symbol: string;
  direction: 'BUY' | 'SELL';
  /** Peso líquido em % do capital da estratégia (long top-k − cabaz igual) */
  weightPct: number;
  z: number;
  zRank: number;
}

/** Long 1/k nas k moedas de maior z; short 1/N em todas as N (cabaz igual). Peso líquido por moeda. */
export function targetPositions(z: Record<string, number>, longCount: number): TargetPosition[] {
  const ranked = Object.entries(z).sort((a, b) => b[1] - a[1]);
  const n = ranked.length;
  if (n < longCount * 2) return [];
  return ranked
    .map(([symbol, v], i) => {
      const w = (i < longCount ? 1 / longCount : 0) - 1 / n;
      return { symbol, direction: (w > 0 ? 'BUY' : 'SELL') as 'BUY' | 'SELL', weightPct: Math.abs(w) * 100, z: v, zRank: i + 1 };
    })
    .filter((p) => p.weightPct > 1e-9);
}

/** Época da grelha de reequilíbrio (igual ao backtest: barras 4h desde 01/01/2021 00:00 UTC) */
export const REBALANCE_EPOCH = Date.UTC(2021, 0, 1);

/** Última barra da grelha (abertura) que já fechou até `lastClosedBar` */
export function lastGridBar(lastClosedBar: number, barMs: number, everyBars: number): number {
  const k = Math.floor((lastClosedBar - REBALANCE_EPOCH) / barMs);
  return REBALANCE_EPOCH + (k - (((k % everyBars) + everyBars) % everyBars)) * barMs;
}
