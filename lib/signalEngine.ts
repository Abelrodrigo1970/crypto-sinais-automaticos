/**
 * Motor de sinais: corre as estratégias registadas em lib/strategies sobre o universo
 * de ações da Bybit. Cada sinal é uma posição: abre no fecho da vela de entrada e fecha
 * quando a regra de saída da estratégia dispara.
 */

import { prisma } from './db';
import { fetchCandles, fetchCurrentPrice, fetchStockUniverse, type Candle, type UniverseAsset } from './marketData';
import { fetchUnderlyingDaily, fetchYahooDaily } from './underlyingData';
import { STRATEGIES } from './strategies';
import { isPortfolio, type MarketContext, type StrategyDefinition } from './strategies/types';
import { EXIT_RETRY_STATUSES, canClose, canOpen, closePosition, openPosition } from './bybitTrading';

const CONCURRENCY = 4;
/** Só entra se a vela de sinal abriu há menos disto (evita entradas atrasadas no dia seguinte) */
const ENTRY_MAX_BAR_AGE_MS = 22 * 60 * 60_000;

/** Garante uma linha em Strategy por cada estratégia registada; desativa as que saíram do registo. */
export async function syncStrategies(): Promise<void> {
  const names = STRATEGIES.map((s) => s.name);
  for (const def of STRATEGIES) {
    await prisma.strategy.upsert({
      where: { name: def.name },
      create: {
        name: def.name,
        displayName: def.displayName,
        description: def.description,
        params: JSON.stringify(def.defaultParams),
        isActive: false,
      },
      update: { displayName: def.displayName, description: def.description },
    });
  }
  await prisma.strategy.updateMany({
    where: { name: { notIn: names }, isActive: true },
    data: { isActive: false },
  });
}

function parseParams(json: string | null): Record<string, unknown> {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

type Series = { candles: Candle[]; priceScale: number; ticker?: string };

/** Velas da estratégia + fator para converter níveis em preço Bybit. Cache partilhada na corrida. */
function makeLoader(cache: Map<string, Promise<Series | null>>) {
  return (def: StrategyDefinition<any>, symbol: string, bybitPrice: number): Promise<Series | null> => {
    const key = `${def.source}|${symbol}|${def.timeframe}|${def.candleLimit}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        def.source === 'underlying'
          ? fetchUnderlyingDaily(symbol, bybitPrice, def.candleLimit)
          : fetchCandles(symbol, def.timeframe, def.candleLimit).then((candles) => ({ candles, priceScale: 1 }))
      );
    }
    return cache.get(key)!;
  };
}

export interface RunStats {
  opened: number;
  closed: number;
  updated: number;
}

async function runStrategy(
  def: StrategyDefinition<any>,
  dbStrategy: { id: string; displayName: string; params: string; tradingOn: boolean },
  load: ReturnType<typeof makeLoader>,
  market: MarketContext | undefined
): Promise<RunStats> {
  const params = { ...def.defaultParams, ...parseParams(dbStrategy.params) };
  const exclude = new Set<string>(Array.isArray(params.excludeSymbols) ? params.excludeSymbols : []);
  const include = new Set<string>(Array.isArray(params.includeSymbols) ? params.includeSymbols : []);
  // Com lista fixa de ações, o filtro de volume 24h deixa de se aplicar (só têm de estar em negociação)
  const universe = include.size
    ? (await fetchStockUniverse({ ...def.universe, minTurnover24h: 0 })).filter((a) => include.has(a.symbol))
    : await fetchStockUniverse(def.universe);
  const bySymbol = new Map(universe.map((a) => [a.symbol, a]));
  const stats: RunStats = { opened: 0, closed: 0, updated: 0 };

  // 1) Posições abertas: sair ou atualizar o stop (mesmo que o ativo já não esteja no universo)
  const open = await prisma.signal.findMany({ where: { strategyId: dbStrategy.id, status: 'OPEN' } });
  const openSymbols = new Set(open.map((s) => s.symbol));
  await mapLimit(open, CONCURRENCY, async (sig) => {
    try {
      const price = bySymbol.get(sig.symbol)?.lastPrice ?? (await fetchCurrentPrice(sig.symbol));
      const series = await load(def, sig.symbol, price);
      if (!series || !sig.barTime) return;
      const info = JSON.parse(sig.extraInfo || '{}');
      const scale: number = info.priceScale ?? series.priceScale;
      const asset = bySymbol.get(sig.symbol) ?? ({ symbol: sig.symbol } as UniverseAsset);
      const decision = def.manage(
        { symbol: sig.symbol, asset, candles: series.candles, params },
        { direction: sig.direction as 'BUY' | 'SELL', entryBarTime: sig.barTime.getTime(), entryRefPrice: info.refPrice }
      );
      const stopLoss = decision.stopLoss == null ? sig.stopLoss : decision.stopLoss * scale;
      if (decision.exit) {
        const resultPct = ((price - sig.entryPrice) / sig.entryPrice) * 100 * (sig.direction === 'BUY' ? 1 : -1);
        const closedSig = await prisma.signal.update({
          where: { id: sig.id },
          data: { status: 'CLOSED', exitPrice: price, exitAt: new Date(), resultPct, exitReason: decision.reason, stopLoss, lastCheckedAt: new Date() },
        });
        stats.closed++;
        if (canClose() && closedSig.execStatus && ['FILLED', 'PARTIAL'].includes(closedSig.execStatus)) {
          await closePosition(closedSig, price);
        }
        openSymbols.delete(sig.symbol); // como no backtest, pode voltar a entrar no fecho desta mesma vela
      } else {
        await prisma.signal.update({ where: { id: sig.id }, data: { stopLoss, lastCheckedAt: new Date() } });
        stats.updated++;
      }
    } catch (error) {
      console.error(`[${def.name}] erro a gerir ${sig.symbol}:`, error instanceof Error ? error.message : error);
    }
  });

  // 1b) Saídas Bybit que falharam ou ficaram parciais em corridas anteriores
  if (canClose()) {
    const retries = await prisma.signal.findMany({
      where: { strategyId: dbStrategy.id, status: 'CLOSED', execStatus: { in: EXIT_RETRY_STATUSES } },
    });
    for (const sig of retries) {
      try {
        await closePosition(sig, bySymbol.get(sig.symbol)?.lastPrice ?? (await fetchCurrentPrice(sig.symbol)));
      } catch (error) {
        console.error(`[${def.name}] erro a repetir saída ${sig.symbol}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // 2) Entradas novas nos ativos sem posição aberta
  const tradeEntries = await canOpen(dbStrategy.tradingOn);
  const candidates = universe.filter((a) => !exclude.has(a.symbol) && !openSymbols.has(a.symbol));
  await mapLimit(candidates, CONCURRENCY, async (asset) => {
    try {
      const series = await load(def, asset.symbol, asset.lastPrice);
      if (!series || series.candles.length < def.candleLimit) return;
      const last = series.candles[series.candles.length - 1];
      if (Date.now() - last.timestamp > ENTRY_MAX_BAR_AGE_MS) return;

      const barTime = new Date(last.timestamp);
      const already = await prisma.signal.findFirst({
        where: { strategyId: dbStrategy.id, symbol: asset.symbol, barTime },
        select: { id: true },
      });
      if (already) return;

      const signal = def.evaluate({ symbol: asset.symbol, asset, candles: series.candles, params, market });
      if (!signal) return;

      const entryPrice = asset.lastPrice;
      const scale = entryPrice / last.close;
      const toBybit = (v?: number) => (v == null ? null : v * scale);
      const created = await prisma.signal.create({
        data: {
          symbol: asset.symbol,
          direction: signal.direction,
          timeframe: def.timeframe,
          strategyId: dbStrategy.id,
          strategyName: dbStrategy.displayName,
          entryPrice,
          stopLoss: toBybit(signal.stopLoss),
          target1: toBybit(signal.target1),
          target2: toBybit(signal.target2),
          target3: toBybit(signal.target3),
          strength: Math.max(0, Math.min(100, Math.round(signal.strength))),
          status: 'OPEN',
          barTime,
          extraInfo: JSON.stringify({
            source: def.source,
            ticker: series.ticker ?? asset.symbol,
            refPrice: last.close,
            priceScale: scale,
            barTime: last.timestamp,
            ...signal.info,
          }),
        },
      });
      stats.opened++;
      if (tradeEntries) await openPosition(created);
    } catch (error) {
      console.error(`[${def.name}] erro em ${asset.symbol}:`, error instanceof Error ? error.message : error);
    }
  });

  return stats;
}

export interface RunAllStrategiesOptions {
  /** Corre só estas estratégias (códigos), mesmo que inativas */
  only?: string[];
}

/** Corre as estratégias ativas e devolve o nº de posições abertas nesta corrida. */
export async function runAllStrategies(options: RunAllStrategiesOptions = {}): Promise<number> {
  await syncStrategies();

  const dbStrategies = await prisma.strategy.findMany({
    where: options.only?.length ? { name: { in: options.only } } : { isActive: true },
  });
  const load = makeLoader(new Map());
  let opened = 0;
  let market: MarketContext | undefined;
  if (dbStrategies.some((s) => {
    const d = STRATEGIES.find((x) => x.name === s.name);
    return d && !isPortfolio(d) && d.needsMarket;
  })) {
    try {
      const { candles, sessionOpen } = await fetchYahooDaily('QQQ', '1y');
      // durante a sessão a última vela ainda está em formação
      if (sessionOpen && candles.length && Date.now() - candles[candles.length - 1].timestamp < 24 * 60 * 60_000) candles.pop();
      market = { qqq: candles };
    } catch (error) {
      console.error('[signalEngine] sem dados do QQQ (estratégias com filtro de regime não entram):', error instanceof Error ? error.message : error);
    }
  }

  for (const dbStrategy of dbStrategies) {
    const def = STRATEGIES.find((s) => s.name === dbStrategy.name);
    if (!def) continue;
    const started = Date.now();
    let stats: RunStats;
    try {
      stats = isPortfolio(def)
        ? await def.run({ strategy: dbStrategy, params: { ...def.defaultParams, ...parseParams(dbStrategy.params) } })
        : await runStrategy(def, dbStrategy, load, def.needsMarket ? market : undefined);
    } catch (error) {
      console.error(`[signalEngine] ${def.name} falhou:`, error instanceof Error ? error.message : error);
      continue;
    }
    opened += stats.opened;
    console.log(
      `[signalEngine] ${def.name}: ${stats.opened} abertas, ${stats.closed} fechadas, ${stats.updated} atualizadas em ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
  }

  if (dbStrategies.length === 0) {
    console.log('[signalEngine] Nenhuma estratégia ativa.');
  }
  return opened;
}
