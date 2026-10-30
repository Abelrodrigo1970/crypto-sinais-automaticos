import { prisma } from '../db';
import { fetchCandles, fetchCurrentPrice } from '../marketData';
import { calculateRSI, getCloses } from '../indicators';
import { fetchAllPerps, mapLimit } from './scanner10';
import type { PortfolioStrategyDefinition } from './types';

type Params = {
  /** Universo: posições rankFrom..rankTo por capitalização (CoinMarketCap) a 1 de janeiro do ano, sem stablecoins */
  rankFrom: number;
  rankTo: number;
  rsiPeriod: number;
  /** Long quando o RSI diário cruza acima deste nível; fecha quando cruza abaixo */
  level: number;
  /** Short (RSI cruza abaixo do nível) só com o fecho diário do BTC abaixo da EMA desta janela; 0 = sem shorts */
  btcEmaShort: number;
  /** % do capital por posição (5% = 100 USD numa conta de 2 000 USD) */
  sizePct: number;
  leverage: number;
  excludeSymbols: string[];
};

const DAY = 86_400_000;
const CMC_LISTING = 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listings/historical';
/** Stablecoins e tokens embrulhados: não contam para o ranking (igual ao backtest) */
const NOT_RANKED = new Set([
  'USDT', 'USDC', 'BUSD', 'DAI', 'UST', 'USDE', 'PYUSD', 'USD1', 'TUSD', 'USDP', 'PAX', 'FDUSD', 'WBTC', 'BTCB',
  'HEDG', '999', 'MIN', 'INO', 'CC', 'M',
]);

function ema(values: number[], span: number): number[] {
  const a = 2 / (span + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : a * v + (1 - a) * out[i - 1]));
  return out;
}

function parseInfo(extraInfo: string | null): Record<string, any> {
  try {
    return JSON.parse(extraInfo || '{}');
  } catch {
    return {};
  }
}

async function closeSignal(sig: { id: string; direction: string; entryPrice: number }, price: number, reason: string) {
  const resultPct = ((price - sig.entryPrice) / sig.entryPrice) * 100 * (sig.direction === 'BUY' ? 1 : -1);
  await prisma.signal.update({
    where: { id: sig.id },
    data: { status: 'CLOSED', exitPrice: price, exitAt: new Date(), resultPct, exitReason: reason, lastCheckedAt: new Date() },
  });
}

/** Lista do top por capitalização a 1 de janeiro de `year`, por ordem (símbolos CoinMarketCap) */
const rankingCache = new Map<number, string[]>();
async function cmcRankingAtYearStart(year: number): Promise<string[]> {
  const hit = rankingCache.get(year);
  if (hit) return hit;
  const res = await fetch(`${CMC_LISTING}?date=${year}-01-01&limit=80&start=1&convertId=2781`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoinMarketCap ranking ${year}: HTTP ${res.status}`);
  const j = await res.json();
  const list: string[] = (j?.data ?? []).map((c: any) => String(c.symbol));
  if (list.length < 40) throw new Error(`CoinMarketCap ranking ${year}: só ${list.length} moedas`);
  rankingCache.set(year, list);
  return list;
}

/**
 * Universo do ano: percorre o ranking de 1 de janeiro, ignora stablecoins e moedas sem perpétuo na Bybit,
 * e devolve as posições rankFrom..rankTo (perpétuos Bybit).
 */
export async function yearUniverse(year: number, params: Params): Promise<string[]> {
  const ranking = await cmcRankingAtYearStart(year);
  const trading = new Set((await fetchAllPerps()).map((p) => p.symbol));
  const exclude = new Set(params.excludeSymbols ?? []);
  const ranked: string[] = [];
  for (const coin of ranking) {
    if (NOT_RANKED.has(coin.toUpperCase())) continue;
    const symbol = [`${coin}USDT`, `1000${coin}USDT`, `${coin}1000USDT`, `10000${coin}USDT`].find((s) => trading.has(s));
    if (!symbol) continue;
    ranked.push(symbol);
    if (ranked.length === params.rankTo) break;
  }
  return ranked.slice(params.rankFrom - 1).filter((s) => !exclude.has(s));
}

/**
 * RSI 60 diário no top 11–30 por capitalização (estudo de 30/10/2026, scratchpad wk20/rsi60*.py).
 * Universo fixo durante o ano: posições 11 a 30 do CoinMarketCap a 1 de janeiro, sem stablecoins.
 * Long quando o RSI(14) diário cruza acima de 60, fecha quando cruza abaixo. Short quando cruza abaixo de 60
 * e o BTC fecha abaixo da EMA200 diária; fecha quando o RSI volta acima de 60. Sem stop nem alvo.
 * Backtest Binance 2020–out/2026 a 100 USD por trade: +4 495 USD (2 000 → 6 495), pior queda −892 USD, 27% dos trades
 * ganham, média +2,25 USD/trade; Bybit 2023–26: +3 230 USD (todos os anos positivos). Stops e alvos testados pioram.
 * Só estudo: não envia ordens à Bybit.
 */
export const rsi60Top: PortfolioStrategyDefinition<Params> = {
  kind: 'portfolio',
  name: 'RSI60_TOP11_30',
  displayName: 'RSI 60 top 11–30',
  description:
    'Universo: moedas nas posições 11 a 30 por capitalização (CoinMarketCap) a 1 de janeiro de cada ano, sem stablecoins. ' +
    'No fecho diário: long quando o RSI(14) cruza acima de 60, fecha quando cruza abaixo de 60. ' +
    'Short quando o RSI cruza abaixo de 60 e o BTC fecha abaixo da EMA200 diária; fecha quando o RSI volta acima de 60. ' +
    'Sem stop nem alvo. 100 USD por posição (5% de 2 000 USD). Na mudança de ano fecha as moedas que saem do universo. ' +
    'Só estudo: não envia ordens à Bybit.',
  timeframe: '1d',
  defaultParams: {
    rankFrom: 11,
    rankTo: 30,
    rsiPeriod: 14,
    level: 60,
    btcEmaShort: 200,
    sizePct: 5,
    leverage: 1,
    excludeSymbols: [],
  },

  async run({ strategy, params }) {
    const stats = { opened: 0, closed: 0, updated: 0 };
    const btc = await fetchCandles('BTCUSDT', '1d', 500);
    const lastBar = btc[btc.length - 1].timestamp; // abertura da última vela diária fechada
    const barTime = new Date(lastBar);
    const year = new Date(lastBar + DAY).getUTCFullYear(); // ano em que a vela fechou
    const btcClose = btc[btc.length - 1].close;
    const btcEma = params.btcEmaShort > 0 ? ema(btc.map((c) => c.close), params.btcEmaShort).pop()! : null;
    const bear = btcEma !== null && btcClose < btcEma;

    let universe: string[];
    try {
      universe = await yearUniverse(year, params);
    } catch (error) {
      console.error(`[${rsi60Top.name}] sem universo (tenta na próxima corrida):`, error instanceof Error ? error.message : error);
      return stats;
    }
    const open = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' } });

    // 1) Mudança de ano: fecha posições em moedas que saíram do universo
    for (const sig of open.filter((s) => !universe.includes(s.symbol))) {
      try {
        await closeSignal(sig, await fetchCurrentPrice(sig.symbol), `saiu do top ${params.rankFrom}–${params.rankTo} de ${year}`);
        stats.closed++;
      } catch (error) {
        console.error(`[${rsi60Top.name}] erro a fechar ${sig.symbol}:`, error instanceof Error ? error.message : error);
      }
    }

    // 2) RSI de cada moeda na última vela diária fechada (a mesma do BTC)
    const rows = await mapLimit(universe, 6, async (symbol) => {
      try {
        const c = await fetchCandles(symbol, '1d', 250);
        if (!c.length || c[c.length - 1].timestamp !== lastBar) return null; // vela do dia ainda não disponível
        const closes = getCloses(c);
        const rsi = calculateRSI(closes, params.rsiPeriod);
        const prev = calculateRSI(closes.slice(0, -1), params.rsiPeriod);
        if (rsi === null || prev === null) return null;
        return { symbol, rsi, prev, close: closes[closes.length - 1] };
      } catch {
        return null;
      }
    });

    const crosses: string[] = [];
    for (const r of rows) {
      if (!r) continue;
      const up = r.rsi > params.level && r.prev <= params.level;
      const down = r.rsi <= params.level && r.prev > params.level;
      const current = open.find((s) => s.symbol === r.symbol && universe.includes(s.symbol));
      try {
        // saída: o RSI cruzou contra a posição
        if (current && ((current.direction === 'BUY' && down) || (current.direction === 'SELL' && up))) {
          await closeSignal(current, await fetchCurrentPrice(r.symbol), `RSI ${r.prev.toFixed(1)} → ${r.rsi.toFixed(1)} (cruzou ${params.level})`);
          stats.closed++;
        } else if (current) {
          await prisma.signal.update({ where: { id: current.id }, data: { lastCheckedAt: new Date() } });
          stats.updated++;
          continue;
        }
        // entrada: uma por moeda e por vela (as corridas seguintes do mesmo dia não repetem)
        const direction = up ? 'BUY' : down && bear ? 'SELL' : null;
        if (!direction) continue;
        if (await prisma.signal.findFirst({ where: { strategyId: strategy.id, symbol: r.symbol, barTime }, select: { id: true } })) continue;
        const price = await fetchCurrentPrice(r.symbol);
        await prisma.signal.create({
          data: {
            symbol: r.symbol, direction, timeframe: '1d', strategyId: strategy.id, strategyName: strategy.displayName,
            entryPrice: price, strength: 60, status: 'OPEN', barTime,
            extraInfo: JSON.stringify({
              source: 'bybit', rsi: Math.round(r.rsi * 10) / 10, rsiPrev: Math.round(r.prev * 10) / 10, barClose: r.close,
              btcClose, btcEma, universeYear: year, sizePct: params.sizePct, sizeUsd: 100, leverage: params.leverage,
            }),
          },
        });
        stats.opened++;
        crosses.push(`${direction === 'BUY' ? 'long' : 'short'} ${r.symbol}`);
      } catch (error) {
        console.error(`[${rsi60Top.name}] erro em ${r.symbol}:`, error instanceof Error ? error.message : error);
      }
    }
    if (crosses.length) console.log(`[${rsi60Top.name}] ${barTime.toISOString().slice(0, 10)} (BTC ${bear ? 'abaixo' : 'acima'} da EMA${params.btcEmaShort}): ${crosses.join(', ')}`);
    // Só estudo: sem openPosition()
    return stats;
  },
};
