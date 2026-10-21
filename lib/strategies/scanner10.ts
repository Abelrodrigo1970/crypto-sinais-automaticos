import { prisma } from '../db';
import { fetchCandles, fetchCurrentPrice, type Candle } from '../marketData';
import { fetchPremiumRegime } from '../coinbasePremium';
import { applyBars, blendedPct, dailyStage, finalStage, rankList, type PartialState, type Scanner10Item } from './scanner10Calc';
import type { PortfolioStrategyDefinition } from './types';

type Params = {
  /** Compra as moedas da lista com pontuação acima disto */
  minScore: number;
  /** Só compra com o prémio da Coinbase em regime positivo (média 7d > 90d) */
  coinbaseFilter: boolean;
  /** Alvos: % de subida e fração da posição vendida em cada um */
  targets: Array<{ pct: number; frac: number }>;
  /** Stop no que estiver aberto, em % abaixo da entrada */
  stopPct: number;
  /** Fecha o resto ao fim de N dias */
  maxDays: number;
  /** % do saldo por trade */
  sizePct: number;
  maxPositions: number;
  leverage: number;
  excludeSymbols: string[];
};

const BYBIT = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const DAY = 86_400_000;
const H4 = 4 * 3_600_000;
/** Entradas só nas primeiras horas depois do fecho diário (o backtest compra ao fecho) */
const ENTRY_MAX_DELAY_MS = 3 * 3_600_000;
const CONCURRENCY = 8;
/** Produtos alavancados/inversos que o scanner exclui */
const EXCLUDED_BASES = new Set(['UVXY', 'SVXY', 'VIXY', 'UVIX', 'SVIX', 'SOXS', 'SOXL', 'SQQQ', 'TQQQ', 'SPXU', 'SPXS', 'SDOW', 'UDOW', 'TZA', 'TNA', 'LABD', 'LABU', 'YANG', 'YINN', 'FAZ', 'FAS', 'BOIL', 'KOLD']);

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

/** Perpétuos USDT cripto em negociação, com turnover 24h e preço */
async function fetchAllPerps(): Promise<Array<{ symbol: string; turnover24h: number; lastPrice: number }>> {
  const inst: any[] = [];
  let cursor = '';
  do {
    const j = await getJson(`${BYBIT}/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    inst.push(...(j.result?.list ?? []));
    cursor = j.result?.nextPageCursor ?? '';
  } while (cursor);
  const ok = new Set(
    inst
      .filter((i) => i.status === 'Trading' && i.quoteCoin === 'USDT' && String(i.symbol).endsWith('USDT'))
      .filter((i) => !['stock', 'xstocks', 'ETF'].includes(i.symbolType) && !EXCLUDED_BASES.has(String(i.baseCoin).toUpperCase()))
      .map((i) => i.symbol)
  );
  const tick = await getJson(`${BYBIT}/v5/market/tickers?category=linear`);
  return (tick.result?.list ?? [])
    .filter((t: any) => ok.has(t.symbol))
    .map((t: any) => ({ symbol: t.symbol, turnover24h: parseFloat(t.turnover24h), lastPrice: parseFloat(t.lastPrice) }));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

/** Lista do Scanner 10 no fecho do dia `day` (abertura em ms) */
export async function scanScanner10(day: number): Promise<{ items: Scanner10Item[]; btcDayPct: number | null; scanned: number }> {
  const perps = await fetchAllPerps();
  // pré-filtro barato (o turnover do dia tem de ser ≥ 1M; o de 24h serve de primeira triagem, com margem)
  const pre = perps.filter((p) => p.turnover24h >= 2e5);
  const btc = await fetchCandles('BTCUSDT', '1d', 3, { endTime: day + DAY - 1 });
  const bi = btc.findIndex((c) => c.timestamp === day);
  const btcDayPct = bi > 0 ? (btc[bi].close / btc[bi - 1].close - 1) * 100 : null;
  const daily = await mapLimit(pre, CONCURRENCY, (p) =>
    fetchCandles(p.symbol, '1d', 200, { endTime: day + DAY - 1 }).then((c) => [p.symbol, c] as const).catch(() => [p.symbol, null] as const)
  );
  const passed: Array<{ symbol: string; ds: NonNullable<ReturnType<typeof dailyStage>> }> = [];
  for (const [symbol, c] of daily) {
    if (!c) continue;
    const ds = dailyStage(c, day);
    if (ds) passed.push({ symbol, ds });
  }
  const finals = await mapLimit(passed, CONCURRENCY, async ({ symbol, ds }) => {
    try {
      const h4 = await fetchCandles(symbol, '4h', 200, { endTime: day + DAY - 1 });
      return finalStage(symbol, ds, h4, day, btcDayPct);
    } catch {
      return null;
    }
  });
  return { items: rankList(finals.filter((x): x is Scanner10Item => x !== null)), btcDayPct, scanned: daily.length };
}

function readState(extraInfo: string | null): { info: Record<string, any>; st: PartialState } {
  let info: Record<string, any> = {};
  try {
    info = JSON.parse(extraInfo || '{}');
  } catch {
    /* vazio */
  }
  const st: PartialState = {
    left: typeof info.left === 'number' ? info.left : 1,
    fills: Array.isArray(info.fills) ? info.fills : [],
    lastH4: typeof info.lastH4 === 'number' ? info.lastH4 : 0,
    stopped: !!info.stopped,
  };
  return { info, st };
}

/**
 * Scanner 10 + filtro Coinbase (backtest 2026 com dados Bybit, scratchpad s10/cb_port_ytd.py): compra no fecho diário
 * as moedas da lista com pontuação > 20 quando o prémio da Coinbase está em regime positivo; vende 40% a +10%,
 * 30% a +20%, 30% a +60%; stop −25% no resto; fecha o que sobrar aos 60 dias.
 * 10 000 USDT a 2%/trade (jan–out/2026): 14 507 com filtro vs 10 295 sem filtro; BTC 9 531; DD −19%.
 * Só estudo: as vendas parciais não enviam ordens à Bybit.
 */
export const scanner10: PortfolioStrategyDefinition<Params> = {
  kind: 'portfolio',
  name: 'SCANNER10_COINBASE',
  displayName: 'Scanner 10 + filtro Coinbase (vendas parciais)',
  description:
    'Lista diária do Scanner 10 (caça-rali do bot_scanner) sobre todos os perpétuos USDT cripto da Bybit com volume ≥ 1M. ' +
    'Compra no fecho diário as moedas com pontuação > 20 quando o prémio da Coinbase está em regime positivo (média 7 dias > 90 dias). ' +
    'Vende 40% a +10%, 30% a +20% e 30% a +60%; stop −25% no que estiver aberto; fecha o resto aos 60 dias. ' +
    'Uma posição por moeda. Só estudo: as vendas parciais ainda não enviam ordens à Bybit.',
  timeframe: '1d',
  defaultParams: {
    minScore: 20,
    coinbaseFilter: true,
    targets: [
      { pct: 10, frac: 0.4 },
      { pct: 20, frac: 0.3 },
      { pct: 60, frac: 0.3 },
    ],
    stopPct: 25,
    maxDays: 60,
    sizePct: 2,
    maxPositions: 50,
    leverage: 1,
    excludeSymbols: [],
  },

  async run({ strategy, params }) {
    const stats = { opened: 0, closed: 0, updated: 0 };

    // 1) Posições abertas: vendas parciais/stop nas velas de 4h fechadas, fecho aos maxDays
    const open = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' } });
    for (const sig of open) {
      try {
        if (!sig.barTime) continue;
        const entryAt = sig.barTime.getTime() + DAY;
        const { info, st: st0 } = readState(sig.extraInfo);
        const bars: Candle[] = await fetchCandles(sig.symbol, '4h', Math.min(400, Math.ceil((Date.now() - entryAt) / H4) + 2));
        let st = applyBars(st0, sig.entryPrice, bars.filter((b) => b.timestamp >= entryAt), params.targets, params.stopPct);
        const price = await fetchCurrentPrice(sig.symbol);
        const expired = st.left > 1e-9 && Date.now() >= entryAt + params.maxDays * DAY;
        if (expired) {
          st = { ...st, fills: [...st.fills, { what: `${params.maxDays} dias`, frac: st.left, price, at: Date.now() }], left: 0 };
        }
        const done = st.left <= 1e-9;
        const resultPct = blendedPct(st, sig.entryPrice, price);
        const newInfo = { ...info, left: st.left, fills: st.fills, lastH4: st.lastH4, stopped: st.stopped, realizedPct: blendedPct({ ...st, left: 0 }, sig.entryPrice, price) };
        if (done) {
          const sold = st.fills.reduce((a, f) => a + f.frac, 0) || 1;
          const avgExit = st.fills.reduce((a, f) => a + f.frac * f.price, 0) / sold;
          await prisma.signal.update({
            where: { id: sig.id },
            data: {
              status: 'CLOSED',
              exitPrice: avgExit,
              exitAt: new Date(),
              resultPct,
              exitReason: st.fills.map((f) => `${Math.round(f.frac * 100)}% ${f.what}`).join(' · '),
              extraInfo: JSON.stringify(newInfo),
              lastCheckedAt: new Date(),
            },
          });
          stats.closed++;
        } else {
          await prisma.signal.update({
            where: { id: sig.id },
            data: { extraInfo: JSON.stringify(newInfo), lastCheckedAt: new Date() },
          });
          stats.updated++;
        }
      } catch (error) {
        console.error(`[${scanner10.name}] erro a gerir ${sig.symbol}:`, error instanceof Error ? error.message : error);
      }
    }

    // 2) Entradas: só nas primeiras horas depois do fecho diário UTC
    const day = Math.floor(Date.now() / DAY) * DAY - DAY; // abertura do último dia fechado
    if (Date.now() - (day + DAY) > ENTRY_MAX_DELAY_MS) return stats;
    const barTime = new Date(day);
    const doneToday = await prisma.signal.findFirst({ where: { strategyId: strategy.id, barTime }, select: { id: true } });
    // já comprou hoje (se o filtro estiver desligado ou não houver candidatos, repete na hora seguinte; o resultado é o mesmo)
    if (doneToday) return stats;

    let regime;
    try {
      regime = await fetchPremiumRegime(day);
    } catch (error) {
      console.error(`[${scanner10.name}] sem prémio da Coinbase, entradas adiadas:`, error instanceof Error ? error.message : error);
      return stats;
    }
    const scan = await scanScanner10(day);
    console.log(
      `[${scanner10.name}] ${barTime.toISOString().slice(0, 10)}: prémio 7d ${regime.avg7.toFixed(3)}% vs 90d ${regime.avg90.toFixed(3)}% → filtro ${regime.on ? 'ligado' : 'desligado'}; ` +
        `lista ${scan.items.length} (de ${scan.scanned}), ${scan.items.filter((i) => i.score > params.minScore).length} com pontuação > ${params.minScore}`
    );
    if (params.coinbaseFilter && !regime.on) return stats;

    const exclude = new Set(params.excludeSymbols ?? []);
    const stillOpen = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' }, select: { symbol: true } });
    const busy = new Set(stillOpen.map((s) => s.symbol));
    let openCount = stillOpen.length;
    const prices = new Map((await fetchAllPerps()).map((p) => [p.symbol, p.lastPrice]));
    for (const it of scan.items) {
      if (it.score <= params.minScore || busy.has(it.symbol) || exclude.has(it.symbol)) continue;
      if (openCount >= params.maxPositions) break;
      const price = prices.get(it.symbol);
      if (!price || !Number.isFinite(price)) continue;
      await prisma.signal.create({
        data: {
          symbol: it.symbol,
          direction: 'BUY',
          timeframe: '1d',
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice: price,
          stopLoss: price * (1 - params.stopPct / 100),
          target1: price * (1 + (params.targets[0]?.pct ?? 0) / 100),
          target2: params.targets[1] ? price * (1 + params.targets[1].pct / 100) : null,
          target3: params.targets[2] ? price * (1 + params.targets[2].pct / 100) : null,
          strength: Math.min(100, 60 + (it.score - params.minScore) * 4),
          status: 'OPEN',
          barTime,
          extraInfo: JSON.stringify({
            source: 'bybit',
            score: it.score,
            tipo: it.kind,
            diasDesdeMinimo: it.daysFromLow,
            pctDoMinimo: Math.round(it.pctFromLow * 10) / 10,
            washoutPct: Math.round(it.washPct * 10) / 10,
            rsi4h: it.h4Rsi,
            premio7d: regime.avg7,
            premio90d: regime.avg90,
            refPrice: it.price,
            sizePct: params.sizePct,
            leverage: params.leverage,
            barTime: day,
            left: 1,
            fills: [],
            lastH4: 0,
            stopped: false,
            realizedPct: 0,
          }),
        },
      });
      busy.add(it.symbol);
      stats.opened++;
      openCount++;
      // Só estudo: sem openPosition() — closePosition() da Bybit fecha a posição inteira e não serve para vendas parciais
    }
    return stats;
  },
};
