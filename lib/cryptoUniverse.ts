/**
 * Universo cripto "top N por capitalização a 1 de janeiro do ano corrente" (point-in-time, como no backtest):
 * lista histórica do CoinMarketCap sem stablecoins, tokens embrulhados/LST e ouro tokenizado,
 * restrita aos perpétuos USDT da Bybit em negociação.
 */

const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const CMC_HISTORICAL = 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listings/historical';

const EXCLUDED_TAGS = new Set([
  'stablecoin', 'wrapped-tokens', 'liquid-staking-derivatives', 'tokenized-gold', 'asset-backed-stablecoin',
  'fiat-stablecoin', 'usd-stablecoin', 'tokenized-assets', 'bridged-tokens', 'restaking', 'liquid-restaking-tokens',
]);
const EXCLUDED_NAME_WORDS = ['usd', 'wrapped', 'staked', 'bridged', 'tether', 'dai', 'gold'];

/** Reserva se o CoinMarketCap falhar (top 30 de 01/01/2026, já filtrado) */
const FALLBACK: Record<number, string[]> = {
  2026: [
    'BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'TRX', 'DOGE', 'ADA', 'BCH', 'LINK', 'LEO', 'ZEC', 'HYPE', 'XMR', 'XLM',
    'LTC', 'CC', 'AVAX', 'SUI', 'HBAR', 'SHIB', 'TON', 'WLFI', 'UNI', 'CRO', 'DOT', 'MNT', 'BGB', 'TAO', 'OKB',
  ],
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

const topCache = new Map<number, string[]>();

/** Símbolos (ex.: "BTC") do top 30 por capitalização a 1 de janeiro de `year`, por ordem */
export async function fetchTopByMarketCap(year: number): Promise<string[]> {
  const cached = topCache.get(year);
  if (cached) return cached;
  try {
    const j = await getJson(`${CMC_HISTORICAL}?date=${year}-01-01&limit=80&start=1&convertId=2781`);
    const out: string[] = [];
    for (const x of j.data ?? []) {
      const tags: string[] = x.tags ?? [];
      const name = String(x.name ?? '').toLowerCase();
      if (tags.some((t) => EXCLUDED_TAGS.has(t))) continue;
      if (EXCLUDED_NAME_WORDS.some((w) => name.includes(w))) continue;
      if (!out.includes(x.symbol)) out.push(x.symbol);
      if (out.length >= 30) break;
    }
    if (out.length < 20) throw new Error(`lista curta (${out.length})`);
    topCache.set(year, out);
    return out;
  } catch (error) {
    const fb = FALLBACK[year];
    console.error(`[cryptoUniverse] CoinMarketCap ${year} falhou${fb ? ', a usar a lista embutida' : ''}:`, error instanceof Error ? error.message : error);
    if (!fb) throw error;
    return fb;
  }
}

export interface CryptoPerp {
  /** Símbolo base no CoinMarketCap, ex.: "SHIB" */
  coin: string;
  /** Perpétuo Bybit, ex.: "SHIB1000USDT" */
  symbol: string;
  lastPrice: number;
  /** Posição no ranking de capitalização (1 = maior) */
  rank: number;
}

/** Top N (por capitalização a 1 de janeiro) que tem perpétuo USDT em negociação na Bybit */
export async function fetchCryptoUniverse(topN: number, year = new Date().getUTCFullYear()): Promise<CryptoPerp[]> {
  const top = (await fetchTopByMarketCap(year)).slice(0, topN);
  const inst = await getJson(`${BYBIT_BASE_URL}/v5/market/instruments-info?category=linear&limit=1000`);
  const trading = new Set<string>(
    (inst.result?.list ?? []).filter((i: any) => i.status === 'Trading' && i.quoteCoin === 'USDT').map((i: any) => i.symbol)
  );
  const tick = await getJson(`${BYBIT_BASE_URL}/v5/market/tickers?category=linear`);
  const price = new Map<string, number>((tick.result?.list ?? []).map((t: any) => [t.symbol, parseFloat(t.lastPrice)]));
  const out: CryptoPerp[] = [];
  top.forEach((coin, i) => {
    const symbol = [`${coin}USDT`, `1000${coin}USDT`, `${coin}1000USDT`, `10000${coin}USDT`].find((s) => trading.has(s));
    if (symbol) out.push({ coin, symbol, lastPrice: price.get(symbol) ?? NaN, rank: i + 1 });
  });
  return out;
}
