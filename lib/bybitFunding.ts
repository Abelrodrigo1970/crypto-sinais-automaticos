/**
 * Histórico de funding dos perpétuos Bybit (API pública), para descontar ao resultado das posições.
 * Cache em memória por símbolo (30 min), alargada para trás quando é pedido um período mais antigo.
 */
const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const TTL_MS = 30 * 60_000;

export type FundingPoint = { t: number; rate: number };

const cache = new Map<string, { from: number; fetchedAt: number; points: FundingPoint[] }>();

async function page(symbol: string, endTime: number): Promise<FundingPoint[]> {
  const url = `${BYBIT_BASE_URL}/v5/market/funding/history?category=linear&symbol=${symbol}&endTime=${endTime}&limit=200`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.retCode !== 0) throw new Error(j.retMsg);
  return (j.result?.list ?? []).map((x: any) => ({ t: Number(x.fundingRateTimestamp), rate: parseFloat(x.fundingRate) }));
}

/** Funding entre `from` e agora (mais antigo primeiro) */
export async function fetchFunding(symbol: string, from: number): Promise<FundingPoint[]> {
  const c = cache.get(symbol);
  if (c && c.from <= from && Date.now() - c.fetchedAt < TTL_MS) return c.points;
  const out: FundingPoint[] = [];
  let end = Date.now();
  for (let i = 0; i < 20; i++) {
    const rows = await page(symbol, end);
    if (!rows.length) break;
    out.push(...rows);
    const oldest = Math.min(...rows.map((r) => r.t));
    if (oldest <= from || rows.length < 200) break;
    end = oldest - 1;
  }
  const points = Array.from(new Map(out.map((p) => [p.t, p])).values()).sort((a, b) => a.t - b.t);
  cache.set(symbol, { from, fetchedAt: Date.now(), points });
  return points;
}
