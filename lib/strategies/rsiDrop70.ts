import { prisma } from '../db';
import { fetchCandles, type Candle } from '../marketData';
import { calculateEMA, calculateRSI, getCloses } from '../indicators';
import { fetchAllPerps, mapLimit } from './scanner10';
import type { PortfolioStrategyDefinition } from './types';

type Params = {
  rsiPeriod: number;
  overboughtLevel: number;
  /** Queda mínima do RSI na vela (pontos) */
  minDropPoints: number;
  /** Afastamento mínimo do fecho à EMA (%) */
  minDistancePct: number;
  maPeriod: number;
  /** Stop acima da entrada (%) */
  stopPct: number;
  /** Fecha no toque da EMA80 (alvo da versão antiga) */
  useEmaTarget: boolean;
  /** Fecha o que sobrar ao fim de N horas */
  holdHours: number;
  /** Universo (Scanner 2 antigo): top N perpétuos por volume 24h, com volume ≥ minTurnover24h */
  universeTop: number;
  minTurnover24h: number;
  /** ...e com o fecho a menos de X% da SMA80 (1h) no último scan de 4h */
  universeMaxDistPct: number;
  /** Avalia a vela de 1h ainda aberta (como a app antiga, que corria a cada 30 min) */
  useOpenCandle: boolean;
  sizePct: number;
  maxPositions: number;
  leverage: number;
  excludeSymbols: string[];
};

const HOUR = 3_600_000;
const H4 = 4 * HOUR;
const M15 = 15 * 60_000;

/** Universo antigo: no último scan de 4h (00/04/08/12/16/20 UTC) o fecho estava a menos de maxDist% da SMA80 */
export function inUniverseAt(candles: Candle[], scanAt: number, maPeriod: number, maxDist: number): boolean {
  const k = candles.findIndex((c) => c.timestamp === scanAt - HOUR);
  if (k < maPeriod - 1) return false;
  const win = candles.slice(k - maPeriod + 1, k + 1);
  const sma = win.reduce((a, c) => a + c.close, 0) / maPeriod;
  return Math.abs((candles[k].close / sma - 1) * 100) <= maxDist;
}

/** Sinal na última vela de 1h recebida (mesma regra da versão antiga da app) */
export function evaluateRsiDrop(candles: Candle[], p: Params) {
  const closes = getCloses(candles);
  const rsiCurr = calculateRSI(closes, p.rsiPeriod);
  const rsiPrev = calculateRSI(closes.slice(0, -1), p.rsiPeriod);
  if (rsiCurr === null || rsiPrev === null) return null;
  const drop = rsiPrev - rsiCurr;
  if (!(rsiPrev >= p.overboughtLevel && rsiCurr < p.overboughtLevel && drop >= p.minDropPoints)) return null;
  const em = calculateEMA(closes, p.maPeriod);
  const ema = em?.length ? em[em.length - 1] : null;
  if (!ema) return null;
  const close = closes[closes.length - 1];
  const dist = ((close - ema) / ema) * 100;
  if (!(dist > p.minDistancePct)) return null;
  return { rsiPrev, rsiCurr, drop, dist, ema, close };
}

/** Short: stop primeiro (pior caso), depois o alvo na EMA; sem toque, fecha no fecho da vela que acaba às holdHours */
export function decideShortExit(
  bars: Candle[],
  entry: number,
  target: number | null,
  entryAt: number,
  p: Pick<Params, 'stopPct' | 'holdHours'>,
  now: number
): { price: number; at: number; reason: string } | null {
  const end = entryAt + p.holdHours * HOUR;
  const stopPx = entry * (1 + p.stopPct / 100);
  let last: Candle | null = null;
  for (const b of bars) {
    if (b.timestamp < entryAt || b.timestamp + M15 > end) continue;
    if (b.high >= stopPx) return { price: Math.max(b.open, stopPx), at: b.timestamp + M15, reason: `stop +${p.stopPct}%` };
    if (target !== null && b.low <= target) return { price: Math.min(b.open, target), at: b.timestamp + M15, reason: 'alvo na EMA80' };
    last = b;
  }
  if (now >= end + M15 && last) return { price: last.close, at: last.timestamp + M15, reason: `${p.holdHours}h depois da entrada` };
  return null;
}

function parseInfo(extraInfo: string | null): Record<string, any> {
  try {
    return JSON.parse(extraInfo || '{}');
  } catch {
    return {};
  }
}

/**
 * RSI queda de 70 + afastamento >12% à EMA80 (1h), short. Versão antiga da app (mai–out/2026): 180 sinais,
 * +2,46%/sinal a 24h com custos. Reavaliado com velas Bybit 15m (155 sinais): regras originais SL 6% + alvo EMA80,
 * fecho às 24h → +1,69%/trade; stop 15% sem alvo, fecho às 24h → +2,8% (usado); sem stop +3,2%. Funding não incluído. Só estudo: não envia ordens à Bybit.
 */
export const rsiDrop70: PortfolioStrategyDefinition<Params> = {
  kind: 'portfolio',
  name: 'RSI_OVERBOUGHT_DROP_1H',
  displayName: 'RSI queda de 70 (mín. 4 pts) + afastamento >12% (1h)',
  description:
    'Universo como o Scanner 2 antigo: top 400 perpétuos USDT por volume, a menos de ±10% da SMA80 (1h) no último scan de 4h. Velas de 1h (vela aberta, como a app antiga). VENDA quando o RSI(14) estava ≥70 na vela anterior e cai abaixo de 70 ' +
    'com queda de pelo menos 4 pontos, com o fecho mais de 12% acima da EMA80. Stop 15% acima da entrada, fecha 24h depois ' +
    '(o alvo na EMA80 da versão antiga pode ser ligado nos parâmetros). Uma posição por moeda. Só estudo: não envia ordens à Bybit.',
  timeframe: '1h',
  defaultParams: {
    rsiPeriod: 14,
    overboughtLevel: 70,
    minDropPoints: 4,
    minDistancePct: 12,
    maPeriod: 80,
    stopPct: 15,
    useEmaTarget: false,
    holdHours: 24,
    universeTop: 400,
    minTurnover24h: 100_000,
    universeMaxDistPct: 10,
    useOpenCandle: true,
    sizePct: 2,
    maxPositions: 20,
    leverage: 1,
    excludeSymbols: [],
  },

  async run({ strategy, params }) {
    const stats = { opened: 0, closed: 0, updated: 0 };
    const now = Date.now();

    // 1) Saídas
    const open = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' } });
    for (const sig of open) {
      try {
        const info = parseInfo(sig.extraInfo);
        const entryAt = typeof info.entryAt === 'number' ? info.entryAt : sig.generatedAt.getTime();
        const bars = await fetchCandles(sig.symbol, '15m', Math.min(1000, Math.ceil((now - entryAt) / M15) + 2));
        const ex = decideShortExit(bars, sig.entryPrice, sig.target1 ?? null, entryAt, params, now);
        if (!ex) {
          await prisma.signal.update({ where: { id: sig.id }, data: { lastCheckedAt: new Date() } });
          stats.updated++;
          continue;
        }
        await prisma.signal.update({
          where: { id: sig.id },
          data: {
            status: 'CLOSED',
            exitPrice: ex.price,
            exitAt: new Date(ex.at),
            resultPct: (1 - ex.price / sig.entryPrice) * 100,
            exitReason: ex.reason,
            lastCheckedAt: new Date(),
          },
        });
        stats.closed++;
      } catch (error) {
        console.error(`[${rsiDrop70.name}] erro a gerir ${sig.symbol}:`, error instanceof Error ? error.message : error);
      }
    }

    // 2) Entradas: vela de 1h atual (aberta) ou a última fechada
    const barOpen = Math.floor(now / HOUR) * HOUR - (params.useOpenCandle ? 0 : HOUR);
    const scanAt = Math.floor(now / H4) * H4;
    const barTime = new Date(barOpen);
    const exclude = new Set(params.excludeSymbols ?? []);
    const stillOpen = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' }, select: { symbol: true } });
    const busy = new Set(stillOpen.map((s) => s.symbol));
    const doneThisBar = await prisma.signal.findMany({ where: { strategyId: strategy.id, barTime }, select: { symbol: true } });
    for (const d of doneThisBar) busy.add(d.symbol);

    const perps = (await fetchAllPerps())
      .filter((p) => p.turnover24h >= params.minTurnover24h)
      .sort((a, b) => b.turnover24h - a.turnover24h)
      .slice(0, params.universeTop)
      .filter((p) => !exclude.has(p.symbol) && !busy.has(p.symbol));
    const price = new Map(perps.map((p) => [p.symbol, p.lastPrice]));
    const found = await mapLimit(perps, 8, async (p) => {
      try {
        const c = await fetchCandles(p.symbol, '1h', params.maPeriod + 150, { includeOpenCandle: params.useOpenCandle });
        if (c.length < params.maPeriod + 20 || c[c.length - 1].timestamp !== barOpen) return null;
        if (!inUniverseAt(c, scanAt, params.maPeriod, params.universeMaxDistPct)) return null;
        const s = evaluateRsiDrop(c, params);
        return s ? { symbol: p.symbol, ...s } : null;
      } catch {
        return null;
      }
    });
    const hits = found.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => b.dist - a.dist);
    console.log(`[${rsiDrop70.name}] ${barTime.toISOString().slice(0, 13)}h: ${perps.length} moedas analisadas, ${hits.length} sinais`);

    let openCount = stillOpen.length;
    for (const h of hits) {
      if (openCount >= params.maxPositions) break;
      const entry = price.get(h.symbol);
      if (!entry || !(entry > h.ema)) continue;
      await prisma.signal.create({
        data: {
          symbol: h.symbol,
          direction: 'SELL',
          timeframe: '1h',
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice: entry,
          stopLoss: entry * (1 + params.stopPct / 100),
          target1: params.useEmaTarget ? h.ema : null,
          strength: Math.min(100, Math.max(70, Math.round(70 + Math.min(h.drop - params.minDropPoints, 8) * 2 + Math.min(Math.max(h.dist - params.minDistancePct, 0), 18)))),
          status: 'OPEN',
          barTime,
          extraInfo: JSON.stringify({
            source: 'bybit',
            rsiPrev: Math.round(h.rsiPrev * 100) / 100,
            rsiCurr: Math.round(h.rsiCurr * 100) / 100,
            drop: Math.round(h.drop * 100) / 100,
            distancePct: Math.round(h.dist * 100) / 100,
            ema80: h.ema,
            closeSinal: h.close,
            entryAt: Date.now(),
            sizePct: params.sizePct,
            leverage: params.leverage,
          }),
        },
      });
      openCount++;
      stats.opened++;
      // Só estudo: sem openPosition()
    }
    return stats;
  },
};
