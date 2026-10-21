/**
 * Alavancagem desfeita — cálculo com a mesma semântica do backtest em pandas (scratchpad dd/prem/micro41.py, y30/delev_y30.py):
 * série horária alinhada (fecho, prémio do perpétuo, OI), sem linhas incompletas;
 *   zp   = z(prémio, 168h)
 *   zdp  = z(Δlog preço, 168h);  zoi = z(Δlog OI, 168h)
 *   z24  = z(log(OI_t / OI_{t−24}), 720h)
 *   lo24 = mínimo dos fechos das 24h anteriores
 * Condições: squeeze (zdp>1,5 & zoi<−1,5), liquidações (zdp<−1,5 & zoi<−1,5), OI 24h (z24<−2),
 * capitulação (fecho<lo24 & z24<−1), prémio (zp<−2). Rolling do pandas com min_periods = janela.
 */

export interface HourRow {
  /** Abertura da vela de 1h (ms) */
  t: number;
  c: number;
  pr: number;
  oi: number;
}

function rollingZ(x: number[], w: number): number[] {
  const out = new Array(x.length).fill(NaN);
  for (let i = w - 1; i < x.length; i++) {
    let s = 0;
    let ok = true;
    for (let j = i - w + 1; j <= i; j++) {
      if (Number.isNaN(x[j])) { ok = false; break; }
      s += x[j];
    }
    if (!ok) continue;
    const m = s / w;
    let v = 0;
    for (let j = i - w + 1; j <= i; j++) v += (x[j] - m) ** 2;
    const sd = Math.sqrt(v / (w - 1));
    out[i] = sd > 0 ? (x[i] - m) / sd : NaN;
  }
  return out;
}

export interface DelevState {
  /** Abertura da última vela usada */
  t: number;
  conds: { squeeze: boolean; liquidacoes: boolean; oi24: boolean; capitulacao: boolean; premio: boolean };
  n: number;
  z: { zdp: number; zoi: number; z24: number; zp: number };
  close: number;
}

/** Condições na última linha de `rows` (mais antiga primeiro). Precisa de ≥ 744 linhas para o z24. */
export function computeDelev(rows: HourRow[]): DelevState | null {
  const r = rows.filter((x) => x.c > 0 && x.oi > 0 && Number.isFinite(x.pr));
  const n = r.length;
  if (n < 745) return null;
  const c = r.map((x) => x.c);
  const oi = r.map((x) => x.oi);
  const pr = r.map((x) => x.pr);
  const dp = c.map((v, i) => (i === 0 ? NaN : Math.log(v / c[i - 1])));
  const doi = oi.map((v, i) => (i === 0 ? NaN : Math.log(v / oi[i - 1])));
  const oi24 = oi.map((v, i) => (i < 24 ? NaN : Math.log(v / oi[i - 24])));
  const zp = rollingZ(pr, 168);
  const zdp = rollingZ(dp, 168);
  const zoi = rollingZ(doi, 168);
  const z24 = rollingZ(oi24, 720);
  const i = n - 1;
  let lo24 = Infinity;
  for (let j = i - 24; j < i; j++) lo24 = Math.min(lo24, c[j]);
  const conds = {
    squeeze: zdp[i] > 1.5 && zoi[i] < -1.5,
    liquidacoes: zdp[i] < -1.5 && zoi[i] < -1.5,
    oi24: z24[i] < -2,
    capitulacao: c[i] < lo24 && z24[i] < -1,
    premio: zp[i] < -2,
  };
  return {
    t: r[i].t,
    conds,
    n: Object.values(conds).filter(Boolean).length,
    z: { zdp: zdp[i], zoi: zoi[i], z24: z24[i], zp: zp[i] },
    close: c[i],
  };
}
