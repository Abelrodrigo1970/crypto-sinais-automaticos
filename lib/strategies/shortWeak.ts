import { prisma } from '../db';
import { fetchCandles, fetchCurrentPrice, type Candle } from '../marketData';
import { fetchAllPerps, mapLimit } from './scanner10';
import { mondaysAt1Lisbon } from '../btcPairsHistory';
import { btcDominanceVsEma } from '../btcDominance';
import type { PortfolioStrategyDefinition } from './types';

type Params = {
  /** Universo: as N moedas com maior volume médio diário (7 dias) */
  universeTop: number;
  /** Quantas das mais fracas em 30 dias contra o BTC entram em short */
  basket: number;
  /** Só abre o cabaz com o fecho diário do BTC acima da EMA desta janela */
  btcEma: number;
  /** ...e com a dominância do BTC (BTC.D) acima da sua EMA desta janela (0 = sem este filtro) */
  btcDomEma: number;
  /** Stop de cada short, em % acima da entrada */
  stopPct: number;
  /** % do capital em cada short (o long de BTC fica com a soma dos shorts) */
  sizePct: number;
  /** Idade mínima da moeda (dias de velas diárias) */
  minAgeDays: number;
  leverage: number;
  excludeSymbols: string[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** O cabaz da semana abre até 24h depois de segunda-feira 01:00 de Lisboa */
const OPEN_WINDOW_MS = DAY;

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

/** Segunda-feira 01:00 de Lisboa da semana atual (a mais recente que já passou) */
function currentWeekStart(now: number): number {
  const ts = mondaysAt1Lisbon(now - 8 * DAY, now);
  return ts[ts.length - 1];
}

/** Fecho de uma posição: preço e % na direção do sinal */
async function closeSignal(sig: { id: string; symbol: string; direction: string; entryPrice: number }, price: number, at: Date, reason: string) {
  const resultPct = ((price - sig.entryPrice) / sig.entryPrice) * 100 * (sig.direction === 'BUY' ? 1 : -1);
  await prisma.signal.update({
    where: { id: sig.id },
    data: { status: 'CLOSED', exitPrice: price, exitAt: at, resultPct, exitReason: reason, lastCheckedAt: new Date() },
  });
}

export interface WeakPick {
  symbol: string;
  chg30d: number;
  turnover7: number;
  close: number;
}

/**
 * Seleção da semana a partir das velas diárias fechadas: universo = top N por volume médio de 7 dias (com idade mínima),
 * ordenado pela variação de 30 dias do rácio moeda/BTC; devolve as `basket` mais fracas e o estado do filtro do BTC.
 */
export async function selectWeak(params: Params): Promise<{ picks: WeakPick[]; btcClose: number; btcEma: number; scanned: number }> {
  const btc = await fetchCandles('BTCUSDT', '1d', 300);
  const btcAt = new Map(btc.map((c) => [c.timestamp, c.close]));
  const e = ema(btc.map((c) => c.close), params.btcEma);
  const exclude = new Set(params.excludeSymbols ?? []);
  const perps = (await fetchAllPerps()).filter((p) => p.symbol !== 'BTCUSDT' && p.turnover24h >= 5e5 && !exclude.has(p.symbol));
  const rows = await mapLimit(perps, 8, async (p) => {
    let c: Candle[];
    try {
      c = await fetchCandles(p.symbol, '1d', Math.max(params.minAgeDays, 40));
    } catch {
      return null;
    }
    if (c.length < params.minAgeDays) return null;
    const last = c[c.length - 1];
    const old = c[c.length - 31];
    const bNow = btcAt.get(last.timestamp);
    const bOld = old ? btcAt.get(old.timestamp) : undefined;
    if (!old || !bNow || !bOld) return null;
    const turnover7 = c.slice(-7).reduce((a, x) => a + (x.turnover ?? x.volume * x.close), 0) / 7;
    if (turnover7 < 1e6) return null;
    return { symbol: p.symbol, chg30d: last.close / bNow / (old.close / bOld) - 1, turnover7, close: last.close };
  });
  const universe = rows
    .filter((r): r is WeakPick => r !== null)
    .sort((a, b) => b.turnover7 - a.turnover7)
    .slice(0, params.universeTop);
  const picks = [...universe].sort((a, b) => a.chg30d - b.chg30d).slice(0, params.basket);
  return { picks, btcClose: btc[btc.length - 1].close, btcEma: e[e.length - 1], scanned: universe.length };
}

/**
 * Short semanal às altcoins mais fracas contra o BTC (estudo de 28/10/2026, scratchpad wk/shortbt.py):
 * todas as segundas-feiras, short às 5 piores em 30 dias contra o BTC (5 rendeu mais que 10: +2,51%/semana ativa, t 3,2) entre as 100 de maior volume, com long de BTC do
 * mesmo valor; stop 15% em cada short (no estudo 2020–26 o melhor: +1,71%/semana ativa, t 2,4, menos queda que 20–30%); tudo fecha na segunda-feira seguinte. Só com o BTC acima da EMA50 diária e a
 * BTC.D acima da EMA200 diária (estudo 2020–26 com dados Binance, scratchpad wk20: +1,72%/semana ativa, t 2,0; a BTC.D
 * evitou quase todo 2021–22, quando a estratégia perdia muito).
 * Backtest 2023–out/2026 com custos e funding reais: +2,51%/semana ativa (t 3,2), 65% das semanas positivas; com o BTC
 * abaixo da EMA50 dava 0%. Só estudo: não envia ordens à Bybit.
 */
export const shortWeak: PortfolioStrategyDefinition<Params> = {
  kind: 'portfolio',
  name: 'SHORT_FRACAS_BTC',
  displayName: 'Pares com dominância BTC',
  description:
    'Todas as segundas-feiras à 01:00 de Lisboa: se o fecho diário do BTC estiver acima da EMA50 diária e a dominância do BTC ' +
    '(BTC.D, CoinMarketCap) acima da sua EMA200 diária, abre short às 5 moedas ' +
    'com pior variação de 30 dias contra o BTC entre as 100 de maior volume médio (7 dias), e long de BTC com a soma dos shorts. ' +
    'Stop 15% em cada short. Fecha tudo na segunda-feira seguinte. Se algum dos filtros falhar, não abre nada nessa semana. ' +
    'Só estudo: não envia ordens à Bybit.',
  timeframe: '1d',
  defaultParams: {
    universeTop: 100,
    basket: 5,
    btcEma: 50,
    btcDomEma: 200,
    stopPct: 15,
    sizePct: 10,
    minAgeDays: 60,
    leverage: 1,
    excludeSymbols: [],
  },

  async run({ strategy, params }) {
    const stats = { opened: 0, closed: 0, updated: 0 };
    const now = Date.now();
    const week = currentWeekStart(now);
    const open = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' } });

    // 1) Fim da semana: tudo o que foi aberto numa semana anterior fecha ao preço atual
    for (const sig of open.filter((s) => s.barTime && s.barTime.getTime() < week)) {
      try {
        await closeSignal(sig, await fetchCurrentPrice(sig.symbol), new Date(), 'fim da semana (reequilíbrio)');
        stats.closed++;
      } catch (error) {
        console.error(`[${shortWeak.name}] erro a fechar ${sig.symbol}:`, error instanceof Error ? error.message : error);
      }
    }

    // 2) Stops dos shorts da semana atual (velas de 1h desde a entrada)
    for (const sig of open.filter((s) => s.barTime && s.barTime.getTime() >= week && s.direction === 'SELL')) {
      try {
        const info = parseInfo(sig.extraInfo);
        const entryAt = typeof info.entryAt === 'number' ? info.entryAt : sig.generatedAt.getTime();
        const bars = await fetchCandles(sig.symbol, '1h', Math.min(200, Math.ceil((now - entryAt) / HOUR) + 2), { includeOpenCandle: true });
        const stopPx = sig.entryPrice * (1 + params.stopPct / 100);
        const hit = bars.find((b) => b.timestamp + HOUR > entryAt && b.high >= stopPx);
        if (hit) {
          await closeSignal(sig, Math.max(hit.open, stopPx), new Date(Math.max(hit.timestamp, entryAt)), `stop +${params.stopPct}%`);
          stats.closed++;
        } else {
          await prisma.signal.update({ where: { id: sig.id }, data: { lastCheckedAt: new Date() } });
          stats.updated++;
        }
      } catch (error) {
        console.error(`[${shortWeak.name}] erro no stop de ${sig.symbol}:`, error instanceof Error ? error.message : error);
      }
    }

    // 3) Cabaz da semana (uma vez, nas primeiras 24h depois de segunda-feira 01:00 de Lisboa)
    if (now - week > OPEN_WINDOW_MS) return stats;
    const barTime = new Date(week);
    if (await prisma.signal.findFirst({ where: { strategyId: strategy.id, barTime }, select: { id: true } })) return stats;

    const label = new Date(week).toISOString().slice(0, 10);
    const btc = await fetchCandles('BTCUSDT', '1d', 300);
    const btcEma = ema(btc.map((c) => c.close), params.btcEma);
    const btcClose = btc[btc.length - 1].close;
    if (!(btcClose > btcEma[btcEma.length - 1])) {
      console.log(`[${shortWeak.name}] semana ${label}: BTC ${btcClose.toFixed(0)} abaixo da EMA${params.btcEma} ${btcEma[btcEma.length - 1].toFixed(0)} → sem cabaz`);
      return stats;
    }
    let dom: { dom: number; ema: number } | null = null;
    if (params.btcDomEma > 0) {
      try {
        dom = await btcDominanceVsEma(params.btcDomEma);
      } catch (error) {
        console.error(`[${shortWeak.name}] sem BTC.D, cabaz adiado:`, error instanceof Error ? error.message : error);
        return stats; // tenta de novo na hora seguinte (dentro da janela de 24h)
      }
      if (!(dom.dom > dom.ema)) {
        console.log(`[${shortWeak.name}] semana ${label}: BTC.D ${dom.dom.toFixed(2)}% abaixo da EMA${params.btcDomEma} ${dom.ema.toFixed(2)}% → sem cabaz`);
        return stats;
      }
    }
    const sel = await selectWeak(params);

    const entryAt = Date.now();
    let shortsPct = 0;
    for (const p of sel.picks) {
      let price: number;
      try {
        price = await fetchCurrentPrice(p.symbol);
      } catch {
        continue;
      }
      await prisma.signal.create({
        data: {
          symbol: p.symbol, direction: 'SELL', timeframe: '1d', strategyId: strategy.id, strategyName: strategy.displayName,
          entryPrice: price, stopLoss: price * (1 + params.stopPct / 100), strength: 70, status: 'OPEN', barTime,
          extraInfo: JSON.stringify({
            source: 'bybit', chg30dVsBtc: Math.round(p.chg30d * 10000) / 100, turnover7: Math.round(p.turnover7),
            btcClose: sel.btcClose, btcEma: sel.btcEma, btcDom: dom?.dom, btcDomEma: dom?.ema, universo: sel.scanned, entryAt, sizePct: params.sizePct, leverage: params.leverage,
          }),
        },
      });
      shortsPct += params.sizePct;
      stats.opened++;
    }
    if (shortsPct > 0) {
      const btcPrice = await fetchCurrentPrice('BTCUSDT');
      await prisma.signal.create({
        data: {
          symbol: 'BTCUSDT', direction: 'BUY', timeframe: '1d', strategyId: strategy.id, strategyName: strategy.displayName,
          entryPrice: btcPrice, strength: 70, status: 'OPEN', barTime,
          extraInfo: JSON.stringify({ source: 'bybit', hedge: true, btcClose: sel.btcClose, btcEma: sel.btcEma, entryAt, sizePct: shortsPct, leverage: params.leverage }),
        },
      });
      stats.opened++;
    }
    console.log(`[${shortWeak.name}] semana ${label}: BTC acima da EMA${params.btcEma} → short ${sel.picks.map((p) => p.symbol).join(', ')} + long BTC`);
    // Só estudo: sem openPosition()
    return stats;
  },
};
