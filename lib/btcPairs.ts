import { fetchCandles } from './marketData';
import { fetchAllPerps, mapLimit } from './strategies/scanner10';

const BYBIT = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const CACHE_MS = 30 * 60_000;

export interface BtcPair {
  /** Moeda base, ex.: BICO */
  base: string;
  symbol: string;
  /** Preço da moeda em BTC (rácio dos perpétuos USDT) */
  ratio: number;
  priceUsdt: number;
  turnover24h: number;
  /** Variação em USDT (%) */
  chgUsdt24h: number | null;
  /** Variação do rácio moeda/BTC (%) */
  chg24h: number | null;
  chg7d: number | null;
  chg30d: number | null;
  /** Distância do rácio ao máximo de 30 dias (%) */
  fromHigh30d: number | null;
  /** Existe par spot real com BTC */
  realPair: { bybit: boolean; binance: boolean | null };
}

export interface BtcPairsResult {
  updatedAt: string;
  btcPrice: number;
  btcChg24h: number;
  count: number;
  pairs: BtcPair[];
}

let cache: { at: number; data: BtcPairsResult } | null = null;
let running: Promise<BtcPairsResult> | null = null;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

/** Bases com par spot real cotado em BTC */
async function realBtcBases(): Promise<{ bybit: Set<string>; binance: Set<string> | null }> {
  const by = await getJson(`${BYBIT}/v5/market/instruments-info?category=spot&limit=1000`).catch(() => null);
  const bybit = new Set<string>(
    (by?.result?.list ?? []).filter((x: any) => x.quoteCoin === 'BTC' && x.status === 'Trading').map((x: any) => x.baseCoin)
  );
  // A Binance pode bloquear o IP do servidor; nesse caso fica "desconhecido"
  const bn = await getJson('https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT').catch(() => null);
  const binance = bn?.symbols
    ? new Set<string>(bn.symbols.filter((s: any) => s.quoteAsset === 'BTC' && s.status === 'TRADING').map((s: any) => s.baseAsset))
    : null;
  return { bybit, binance };
}

const pct = (a: number, b: number) => (a / b - 1) * 100;

async function compute(): Promise<BtcPairsResult> {
  const perps = await fetchAllPerps();
  const tick = await getJson(`${BYBIT}/v5/market/tickers?category=linear`);
  const chg = new Map<string, number>(
    (tick.result?.list ?? []).map((t: any) => [t.symbol, parseFloat(t.price24hPcnt) * 100])
  );
  const btc = perps.find((p) => p.symbol === 'BTCUSDT');
  if (!btc) throw new Error('BTCUSDT sem preço');
  const btcChg = chg.get('BTCUSDT') ?? 0;
  const btcDaily = await fetchCandles('BTCUSDT', '1d', 32, { includeOpenCandle: true });
  const btcAt = new Map(btcDaily.map((c) => [c.timestamp, c]));
  const real = await realBtcBases();

  const list = perps.filter((p) => p.symbol !== 'BTCUSDT' && p.lastPrice > 0);
  const rows = await mapLimit(list, 8, async (p): Promise<BtcPair> => {
    const base = p.symbol.replace(/USDT$/, '');
    const c24 = chg.get(p.symbol);
    const row: BtcPair = {
      base,
      symbol: p.symbol,
      ratio: p.lastPrice / btc.lastPrice,
      priceUsdt: p.lastPrice,
      turnover24h: p.turnover24h,
      chgUsdt24h: c24 ?? null,
      chg24h: c24 !== undefined ? ((1 + c24 / 100) / (1 + btcChg / 100) - 1) * 100 : null,
      chg7d: null,
      chg30d: null,
      fromHigh30d: null,
      realPair: { bybit: real.bybit.has(base), binance: real.binance ? real.binance.has(base) : null },
    };
    try {
      const d = await fetchCandles(p.symbol, '1d', 32, { includeOpenCandle: true });
      // rácio diário (fecho da moeda / fecho do BTC no mesmo dia)
      const r = d.filter((c) => btcAt.has(c.timestamp)).map((c) => ({ t: c.timestamp, v: c.close / btcAt.get(c.timestamp)!.close }));
      if (r.length) {
        const now = r[r.length - 1].v;
        if (r.length > 7) row.chg7d = pct(now, r[r.length - 8].v);
        if (r.length > 30) row.chg30d = pct(now, r[r.length - 31].v);
        row.fromHigh30d = pct(now, Math.max(...r.slice(-30).map((x) => x.v)));
      }
    } catch {
      /* sem velas: só 24h */
    }
    return row;
  });
  rows.sort((a, b) => b.turnover24h - a.turnover24h);
  return {
    updatedAt: new Date().toISOString(),
    btcPrice: btc.lastPrice,
    btcChg24h: btcChg,
    count: rows.length,
    pairs: rows,
  };
}

/** Todos os pares moeda/BTC (sintéticos, a partir dos perpétuos USDT da Bybit), com cache de 30 min */
export async function getBtcPairs(force = false): Promise<BtcPairsResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!running) {
    running = compute()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        running = null;
      });
  }
  return running;
}
