/**
 * Dados de mercado da Bybit (API pública v5, perpétuos lineares USDT).
 * Universo: ações (symbolType=stock) e ETFs (symbolType=ETF) cotados como perpétuos.
 */

const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Volume em USDT (turnover); só nas velas da Bybit */
  turnover?: number;
  /** Abertura da vela (ms) */
  timestamp: number;
}

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

const BYBIT_INTERVALS: Record<Timeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

export function timeframeToMs(timeframe: Timeframe): number {
  return TIMEFRAME_MS[timeframe];
}

async function bybitGet<T>(path: string, query: Record<string, string | number | undefined>, retries = 2): Promise<T> {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${BYBIT_BASE_URL}${path}?${qs}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Bybit HTTP ${response.status} em ${path}`);
      }
      const data = await response.json();
      if (data.retCode !== 0) {
        throw new Error(`Bybit retCode ${data.retCode}: ${data.retMsg} (${path})`);
      }
      return data.result as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Erro Bybit em ${path}`);
}

/**
 * Velas em ordem cronológica (mais antiga primeiro).
 * Por omissão exclui a vela ainda em formação, para os sinais só usarem velas fechadas.
 * `limit` acima de 1000 é paginado automaticamente.
 */
export async function fetchCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number = 200,
  options: { endTime?: number; includeOpenCandle?: boolean } = {}
): Promise<Candle[]> {
  const interval = BYBIT_INTERVALS[timeframe];
  if (!interval) throw new Error(`Timeframe não suportado: ${timeframe}`);

  const wanted = options.includeOpenCandle ? limit : limit + 1;
  const out: Candle[] = [];
  let end = options.endTime;

  while (out.length < wanted) {
    const batch = Math.min(1000, wanted - out.length);
    const result = await bybitGet<{ list: string[][] }>('/v5/market/kline', {
      category: 'linear',
      symbol,
      interval,
      limit: batch,
      end,
    });
    const rows = result.list || [];
    if (rows.length === 0) break;
    // Bybit devolve a mais recente primeiro
    for (const c of rows) {
      out.push({
        timestamp: Number(c[0]),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
        turnover: c[6] !== undefined ? parseFloat(c[6]) : undefined,
      });
    }
    if (rows.length < batch) break;
    end = Number(rows[rows.length - 1][0]) - 1;
  }

  out.sort((a, b) => a.timestamp - b.timestamp);
  const deduped = out.filter((c, i) => i === 0 || c.timestamp !== out[i - 1].timestamp);

  if (!options.includeOpenCandle) {
    const now = Date.now();
    const step = TIMEFRAME_MS[timeframe];
    while (deduped.length && deduped[deduped.length - 1].timestamp + step > now) {
      deduped.pop();
    }
  }
  return deduped.slice(-limit);
}

export async function fetchCurrentPrice(symbol: string): Promise<number> {
  const result = await bybitGet<{ list: Array<{ lastPrice: string }> }>('/v5/market/tickers', {
    category: 'linear',
    symbol,
  });
  const price = parseFloat(result.list?.[0]?.lastPrice);
  if (!Number.isFinite(price)) throw new Error(`Preço indisponível para ${symbol}`);
  return price;
}

export type AssetType = 'stock' | 'ETF';

export interface UniverseAsset {
  symbol: string;
  baseCoin: string;
  type: AssetType;
  lastPrice: number;
  price24hPcnt: number;
  turnover24h: number;
}

let universeCache: { at: number; assets: UniverseAsset[] } | null = null;
const UNIVERSE_TTL_MS = 60 * 60_000;

/**
 * Ações + ETFs em negociação na Bybit (perpétuos USDT), com volume 24h.
 * Ordenado por turnover 24h (USDT) decrescente. Cache de 1h.
 */
export async function fetchStockUniverse(options: {
  types?: AssetType[];
  minTurnover24h?: number;
} = {}): Promise<UniverseAsset[]> {
  const types = options.types ?? ['stock', 'ETF'];
  const minTurnover = options.minTurnover24h ?? 0;

  if (!universeCache || Date.now() - universeCache.at > UNIVERSE_TTL_MS) {
    const instruments: Array<{ symbol: string; baseCoin: string; status: string; symbolType?: string }> = [];
    let cursor: string | undefined;
    do {
      const page = await bybitGet<{ list: typeof instruments; nextPageCursor?: string }>(
        '/v5/market/instruments-info',
        { category: 'linear', limit: 1000, cursor }
      );
      instruments.push(...(page.list || []));
      cursor = page.nextPageCursor || undefined;
    } while (cursor);

    const tickers = await bybitGet<{
      list: Array<{ symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string }>;
    }>('/v5/market/tickers', { category: 'linear' });
    const tickerBySymbol = new Map(tickers.list.map((t) => [t.symbol, t]));

    const assets: UniverseAsset[] = [];
    for (const inst of instruments) {
      if (inst.status !== 'Trading') continue;
      if (inst.symbolType !== 'stock' && inst.symbolType !== 'ETF') continue;
      const t = tickerBySymbol.get(inst.symbol);
      assets.push({
        symbol: inst.symbol,
        baseCoin: inst.baseCoin,
        type: inst.symbolType,
        lastPrice: t ? parseFloat(t.lastPrice) : NaN,
        price24hPcnt: t ? parseFloat(t.price24hPcnt) * 100 : NaN,
        turnover24h: t ? parseFloat(t.turnover24h) : 0,
      });
    }
    assets.sort((a, b) => b.turnover24h - a.turnover24h);
    universeCache = { at: Date.now(), assets };
  }

  return universeCache.assets.filter((a) => types.includes(a.type) && a.turnover24h >= minTurnover);
}
