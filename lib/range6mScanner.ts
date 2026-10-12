/**
 * Scanner: top N perpétuos USDT (Binance Futures) com maior amplitude entre a
 * máxima e a mínima dos últimos 6 meses (velas 1d).
 */

const FAPI = 'https://fapi.binance.com/fapi/v1';
const DAY_MS = 86_400_000;

export const RANGE_6M_LOOKBACK_DAYS = 182;
/** Exige quase 6 meses de velas para não misturar listagens recentes. */
export const RANGE_6M_MIN_HISTORY_DAYS = 170;
export const RANGE_6M_DEFAULT_MIN_QUOTE_VOLUME = 1_000_000;

export type Range6mRow = {
  rank: number;
  symbol: string;
  price: number;
  high6m: number;
  high6mAt: string;
  low6m: number;
  low6mAt: string;
  /** (máx / mín − 1) × 100 */
  rangePct: number;
  /** (preço / máx − 1) × 100 — negativo = abaixo da máxima */
  pctFromHigh: number;
  /** (preço / mín − 1) × 100 */
  pctFromLow: number;
  /** Média dos fechos diários no período */
  avgClose6m: number;
  pctFromAvg: number;
  /** (máx + mín) / 2 */
  midRange: number;
  /** 0% = na mínima, 100% = na máxima */
  rangePositionPct: number;
  quoteVolume24h: number;
  tradingViewUrl: string;
};

export type Range6mResult = {
  rows: Range6mRow[];
  candidates: number;
  lookbackDays: number;
  minQuoteVolume: number;
};

type Ticker = { lastPrice: number; quoteVolume: number };
type DailyBar = { t: number; h: number; l: number; c: number };

async function fetchPerpUsdtSymbols(): Promise<Set<string>> {
  const res = await fetch(`${FAPI}/exchangeInfo`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Erro ao buscar exchangeInfo: ${res.statusText}`);
  const data = await res.json();
  return new Set<string>(
    (data.symbols || [])
      .filter(
        (s: any) =>
          s.symbol?.endsWith('USDT') &&
          !s.symbol?.includes('BUSD') &&
          s.status === 'TRADING' &&
          (s.contractType === 'PERPETUAL' || !s.contractType)
      )
      .map((s: any) => s.symbol as string)
  );
}

async function fetchTickers(): Promise<Map<string, Ticker>> {
  const res = await fetch(`${FAPI}/ticker/24hr`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Erro ao buscar ticker 24h: ${res.statusText}`);
  const data = await res.json();
  const map = new Map<string, Ticker>();
  for (const t of data as any[]) {
    const lastPrice = parseFloat(t.lastPrice);
    const quoteVolume = parseFloat(t.quoteVolume);
    if (!t.symbol || !(lastPrice > 0)) continue;
    map.set(t.symbol, { lastPrice, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0 });
  }
  return map;
}

/** Velas 1d ascendentes (inclui a vela do dia em formação). */
async function fetchDailyBars(symbol: string): Promise<DailyBar[]> {
  const res = await fetch(
    `${FAPI}/klines?symbol=${symbol}&interval=1d&limit=${RANGE_6M_LOOKBACK_DAYS + 1}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return [];
  const klines = (await res.json()) as any[][];
  return klines
    .map((k) => ({ t: Number(k[0]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]) }))
    .filter((b) => Number.isFinite(b.t) && b.h > 0 && b.l > 0 && b.c > 0);
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  return out;
}

function toDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export async function fetchTopRange6m(
  limit: number = 30,
  minQuoteVolume: number = RANGE_6M_DEFAULT_MIN_QUOTE_VOLUME
): Promise<Range6mResult> {
  const [perps, tickers] = await Promise.all([fetchPerpUsdtSymbols(), fetchTickers()]);

  const candidates = [...perps]
    .map((symbol) => ({ symbol, ticker: tickers.get(symbol) }))
    .filter((c): c is { symbol: string; ticker: Ticker } => c.ticker != null && c.ticker.quoteVolume >= minQuoteVolume);

  const cutoff = Date.now() - RANGE_6M_LOOKBACK_DAYS * DAY_MS;

  type Partial = Omit<Range6mRow, 'rank'>;
  const partials = await mapPool(candidates, 6, async ({ symbol, ticker }): Promise<Partial | null> => {
    try {
      const bars = (await fetchDailyBars(symbol)).filter((b) => b.t >= cutoff);
      if (bars.length < RANGE_6M_MIN_HISTORY_DAYS) return null;

      let hi = bars[0];
      let lo = bars[0];
      let sumClose = 0;
      for (const b of bars) {
        if (b.h > hi.h) hi = b;
        if (b.l < lo.l) lo = b;
        sumClose += b.c;
      }
      const price = ticker.lastPrice;
      const high6m = Math.max(hi.h, price);
      const low6m = Math.min(lo.l, price);
      const avgClose6m = sumClose / bars.length;
      const span = high6m - low6m;

      return {
        symbol,
        price,
        high6m,
        high6mAt: toDay(price > hi.h ? Date.now() : hi.t),
        low6m,
        low6mAt: toDay(price < lo.l ? Date.now() : lo.t),
        rangePct: (high6m / low6m - 1) * 100,
        pctFromHigh: (price / high6m - 1) * 100,
        pctFromLow: (price / low6m - 1) * 100,
        avgClose6m,
        pctFromAvg: (price / avgClose6m - 1) * 100,
        midRange: (high6m + low6m) / 2,
        rangePositionPct: span > 0 ? ((price - low6m) / span) * 100 : 50,
        quoteVolume24h: ticker.quoteVolume,
        tradingViewUrl: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BINANCE:${symbol}.P`)}`,
      };
    } catch {
      return null;
    }
  });

  const rows = partials
    .filter((r): r is Partial => r != null)
    .sort((a, b) => b.rangePct - a.rangePct)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return { rows, candidates: candidates.length, lookbackDays: RANGE_6M_LOOKBACK_DAYS, minQuoteVolume };
}
