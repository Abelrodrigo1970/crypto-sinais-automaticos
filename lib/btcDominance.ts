/**
 * Dominância do BTC (BTC.D) diária, da API pública de dados da CoinMarketCap (a mesma usada no site).
 */
const CMC_GLOBAL = 'https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical';
const DAY = 86_400_000;

export interface DominancePoint {
  t: number;
  dom: number;
}

/** Série diária de BTC.D (em %) dos últimos `days` dias, mais antiga primeiro */
export async function fetchBtcDominance(days = 900): Promise<DominancePoint[]> {
  const end = Math.floor(Date.now() / 1000);
  const out = new Map<number, number>();
  // a API devolve no máximo ~1 ano por pedido
  for (let start = end - days * 86_400; start < end; start += 365 * 86_400) {
    const to = Math.min(end, start + 365 * 86_400);
    const res = await fetch(`${CMC_GLOBAL}?format=chart&interval=1d&timeStart=${start}&timeEnd=${to}`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`CoinMarketCap BTC.D: HTTP ${res.status}`);
    const j = await res.json();
    for (const q of j?.data?.quotes ?? []) {
      const t = Math.floor(Date.parse(q.timestamp) / DAY) * DAY;
      if (Number.isFinite(t) && typeof q.btcDominance === 'number') out.set(t, q.btcDominance);
    }
  }
  return Array.from(out.entries())
    .map(([t, dom]) => ({ t, dom }))
    .sort((a, b) => a.t - b.t);
}

/** BTC.D atual e a sua EMA de `span` dias */
export async function btcDominanceVsEma(span: number): Promise<{ dom: number; ema: number; at: number }> {
  const s = await fetchBtcDominance(Math.max(900, span * 4));
  if (s.length < span) throw new Error(`BTC.D: só ${s.length} dias de histórico`);
  const a = 2 / (span + 1);
  let e = s[0].dom;
  for (const p of s.slice(1)) e = a * p.dom + (1 - a) * e;
  const last = s[s.length - 1];
  return { dom: last.dom, ema: e, at: last.t };
}
