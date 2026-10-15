/**
 * Motor de sinais: corre as estratégias registadas em lib/strategies sobre
 * o universo de ações/ETFs da Bybit e grava os sinais novos.
 */

import { prisma } from './db';
import { fetchCandles, fetchStockUniverse, type Candle } from './marketData';
import { STRATEGIES } from './strategies';
import type { StrategyDefinition } from './strategies/types';

const CONCURRENCY = 5;

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

async function runStrategy(
  def: StrategyDefinition<any>,
  dbStrategy: { id: string; displayName: string; params: string },
  candleCache: Map<string, Promise<Candle[]>>
): Promise<number> {
  const params = { ...def.defaultParams, ...parseParams(dbStrategy.params) };
  const assets = await fetchStockUniverse(def.universe);
  const cooldownMs = (def.cooldownHours ?? 24) * 60 * 60_000;
  let created = 0;

  await mapLimit(assets, CONCURRENCY, async (asset) => {
    try {
      const key = `${asset.symbol}|${def.timeframe}|${def.candleLimit}`;
      if (!candleCache.has(key)) {
        candleCache.set(key, fetchCandles(asset.symbol, def.timeframe, def.candleLimit));
      }
      const candles = await candleCache.get(key)!;
      if (candles.length < def.candleLimit) return;

      const signal = def.evaluate({ symbol: asset.symbol, asset, candles, params });
      if (!signal) return;

      const recent = await prisma.signal.findFirst({
        where: {
          strategyId: dbStrategy.id,
          symbol: asset.symbol,
          direction: signal.direction,
          generatedAt: { gte: new Date(Date.now() - cooldownMs) },
        },
        select: { id: true },
      });
      if (recent) return;

      await prisma.signal.create({
        data: {
          symbol: asset.symbol,
          direction: signal.direction,
          timeframe: def.timeframe,
          strategyId: dbStrategy.id,
          strategyName: dbStrategy.displayName,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          target1: signal.target1 ?? null,
          target2: signal.target2 ?? null,
          target3: signal.target3 ?? null,
          strength: Math.max(0, Math.min(100, Math.round(signal.strength))),
          extraInfo: JSON.stringify({
            assetType: asset.type,
            candleTime: candles[candles.length - 1].timestamp,
            params,
            ...signal.info,
          }),
        },
      });
      created++;
    } catch (error) {
      console.error(`[${def.name}] erro em ${asset.symbol}:`, error instanceof Error ? error.message : error);
    }
  });

  return created;
}

export interface RunAllStrategiesOptions {
  /** Corre só estas estratégias (códigos), mesmo que inativas */
  only?: string[];
}

/** Corre as estratégias ativas e devolve o nº de sinais criados. */
export async function runAllStrategies(options: RunAllStrategiesOptions = {}): Promise<number> {
  await syncStrategies();

  const dbStrategies = await prisma.strategy.findMany({
    where: options.only?.length ? { name: { in: options.only } } : { isActive: true },
  });
  const candleCache = new Map<string, Promise<Candle[]>>();
  let total = 0;

  for (const dbStrategy of dbStrategies) {
    const def = STRATEGIES.find((s) => s.name === dbStrategy.name);
    if (!def) continue;
    const started = Date.now();
    const created = await runStrategy(def, dbStrategy, candleCache);
    total += created;
    console.log(`[signalEngine] ${def.name}: ${created} sinais em ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  if (dbStrategies.length === 0) {
    console.log('[signalEngine] Nenhuma estratégia ativa.');
  }
  return total;
}
