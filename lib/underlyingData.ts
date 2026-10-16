/**
 * Velas diárias da ação subjacente a um perpétuo Bybit (Yahoo Finance, sessão regular,
 * ajustadas a splits e dividendos). São os mesmos dados que os backtests usaram.
 */

import type { Candle } from './marketData';

/** Bybit baseCoin → ticker Yahoo, quando não é igual */
const YAHOO_OVERRIDES: Record<string, string> = {
  SKHYNIX: '000660.KS',
  SAMSUNG: '005930.KS',
};

/** Ações coreanas cotam em KRW no Yahoo e em USD na Bybit */
const KRW_RANGE = { min: 1 / 2000, max: 1 / 800 };
const MAX_PRICE_GAP = 0.25;

export function yahooTicker(bybitSymbol: string): string {
  const base = bybitSymbol.replace(/USDT$/, '');
  if (YAHOO_OVERRIDES[base]) return YAHOO_OVERRIDES[base];
  // AMDSTOCK, PENGSTOCK, ... (a Bybit acrescenta STOCK quando o ticker colide com uma cripto)
  return base.replace(/STOCK$/, '');
}

export interface UnderlyingSeries {
  ticker: string;
  candles: Candle[];
  /** preço Bybit / fecho do subjacente: converte níveis do subjacente para preço Bybit */
  priceScale: number;
}

export async function fetchYahooDaily(ticker: string, range = '2y'): Promise<{ candles: Candle[]; sessionOpen: boolean }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d&events=div%2Csplit`;
  const response = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status} para ${ticker}`);
  const data = await response.json();
  const r = data?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Yahoo sem dados para ${ticker}`);

  const q = r.indicators.quote[0];
  const adj: (number | null)[] | undefined = r.indicators.adjclose?.[0]?.adjclose;
  const candles: Candle[] = [];
  r.timestamp.forEach((t: number, i: number) => {
    const close = q.close[i];
    if (close == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) return;
    const f = adj?.[i] != null ? (adj[i] as number) / close : 1;
    candles.push({
      timestamp: t * 1000,
      open: q.open[i] * f,
      high: q.high[i] * f,
      low: q.low[i] * f,
      close: close * f,
      volume: q.volume[i] ?? 0,
    });
  });

  const regular = r.meta?.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  const sessionOpen = !!regular && now >= regular.start && now < regular.end;
  return { candles, sessionOpen };
}

/**
 * Velas diárias fechadas do subjacente. Devolve null se o ticker não existir ou se o preço
 * não bater com o da Bybit (ex.: o mesmo ticker é outra empresa).
 */
export async function fetchUnderlyingDaily(bybitSymbol: string, bybitPrice: number, limit: number): Promise<UnderlyingSeries | null> {
  const ticker = yahooTicker(bybitSymbol);
  let result;
  try {
    result = await fetchYahooDaily(ticker);
  } catch (error) {
    console.warn(`[underlying] ${bybitSymbol} → ${ticker}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
  const candles = result.candles;
  // Durante a sessão o Yahoo devolve a vela de hoje ainda em formação
  if (result.sessionOpen && candles.length) {
    const last = candles[candles.length - 1];
    if (Date.now() - last.timestamp < 24 * 60 * 60_000) candles.pop();
  }
  if (!candles.length) return null;

  const lastClose = candles[candles.length - 1].close;
  const priceScale = bybitPrice / lastClose;
  const isKrw = ticker.endsWith('.KS');
  const ok = isKrw
    ? priceScale > KRW_RANGE.min && priceScale < KRW_RANGE.max
    : Math.abs(priceScale - 1) < MAX_PRICE_GAP;
  if (!ok) {
    console.warn(`[underlying] ${bybitSymbol} → ${ticker}: preço não bate (Bybit ${bybitPrice}, Yahoo ${lastClose.toFixed(2)})`);
    return null;
  }
  return { ticker, candles: candles.slice(-limit), priceScale };
}
