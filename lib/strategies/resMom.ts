import { prisma } from '../db';
import { fetchCandles, timeframeToMs } from '../marketData';
import { fetchCryptoUniverse } from '../cryptoUniverse';
import { EXIT_RETRY_STATUSES, canClose, canOpen, closePosition, openPosition } from '../bybitTrading';
import { computeResMom, lastGridBar, targetPositions } from './resMomCalc';
import type { PortfolioStrategyDefinition } from './types';

type Params = {
  /** Universo: top N por capitalização a 1 de janeiro do ano corrente */
  topN: number;
  /** Moedas no lado long (as de maior z) */
  longCount: number;
  /** Janela do momentum, em barras de 4h (84 = 14 dias) */
  lookbackBars: number;
  /** Reequilíbrio a cada N barras de 4h (12 = 2 dias) */
  rebalanceBars: number;
  /** Janela do beta e da volatilidade, em barras de 4h (180 = 30 dias) */
  betaBars: number;
  /** Capital da estratégia em % do saldo: o lado long e o short valem cada um isto */
  capitalPct: number;
  /** Alavancagem por posição na Bybit (exposição bruta = 2 × capitalPct) */
  leverage: number;
  excludeSymbols: string[];
};

const TF = '4h' as const;

/** Força 60–100 (a API de sinais esconde < 60 por omissão): 60 + 20 × |z| */
const strengthOf = (z: number) => Math.round(60 + Math.min(40, Math.abs(z) * 20));

/**
 * Momentum de resíduos entre moedas do top 25 (backtest 2021–set/2026, scratchpad y30):
 * long nas 6 moedas com maior movimento próprio em 14 dias, short num cabaz igual de todo o top 25,
 * reequilíbrio a cada 2 dias. Top 25 / long 6: Sharpe 1,33 (2021–23) e 1,31 (2024–26), DD −30%.
 */
export const resMom: PortfolioStrategyDefinition<Params> = {
  kind: 'portfolio',
  name: 'RESMOM_TOP25',
  displayName: 'Momentum de resíduos cripto (top 25)',
  description:
    'Universo: top 25 por capitalização a 1 de janeiro (CoinMarketCap, sem stablecoins), perpétuos USDT da Bybit. ' +
    'Em barras de 4h, mede o movimento próprio de cada moeda (retorno − beta × média do universo) nos últimos 14 dias, ' +
    'dividido pela sua volatilidade. A cada 2 dias: long nas 6 de maior pontuação e short num cabaz igual de todas; ' +
    'cada moeda fica com a posição líquida (long ou short). Só troca as moedas cuja direção muda.',
  timeframe: TF,
  defaultParams: {
    topN: 25,
    longCount: 6,
    lookbackBars: 84,
    rebalanceBars: 12,
    betaBars: 180,
    capitalPct: 50,
    leverage: 2,
    excludeSymbols: [],
  },

  async run({ strategy, params }) {
    const stats = { opened: 0, closed: 0, updated: 0 };
    const exclude = new Set(params.excludeSymbols ?? []);
    const universe = (await fetchCryptoUniverse(params.topN)).filter((a) => !exclude.has(a.symbol));
    const priceOf = new Map(universe.map((a) => [a.symbol, a.lastPrice]));

    // Saídas Bybit pendentes de corridas anteriores
    if (canClose()) {
      const retries = await prisma.signal.findMany({
        where: { strategyId: strategy.id, status: 'CLOSED', execStatus: { in: EXIT_RETRY_STATUSES } },
      });
      for (const sig of retries) await closePosition(sig, priceOf.get(sig.symbol) ?? sig.exitPrice ?? sig.entryPrice);
    }

    const barMs = timeframeToMs(TF);
    const limit = params.betaBars + params.lookbackBars + 30;
    const candles = await Promise.all(
      universe.map((a) =>
        fetchCandles(a.symbol, TF, limit)
          .then((c) => [a.symbol, c] as const)
          .catch((error) => {
            console.error(`[${resMom.name}] sem velas de ${a.symbol}:`, error instanceof Error ? error.message : error);
            return [a.symbol, null] as const;
          })
      )
    );
    // Uma falha de dados mudaria o cabaz e fecharia posições por engano: não reequilibra
    const failed = candles.filter(([, c]) => c === null).map(([s]) => s);
    if (failed.length) {
      console.error(`[${resMom.name}] reequilíbrio adiado: faltam velas de ${failed.join(', ')}`);
      return stats;
    }
    const lastClosed = Math.max(...candles.map(([, c]) => (c!.length ? c![c!.length - 1].timestamp : 0)));
    const grid = lastGridBar(lastClosed, barMs, params.rebalanceBars);

    const closes: Record<string, Array<[number, number]>> = {};
    for (const [s, c] of candles) {
      // moeda listada há menos de 30 dias fica de fora (como no backtest)
      if (c!.filter((x) => x.timestamp <= grid).length < 180) continue;
      closes[s] = c!.map((x) => [x.timestamp, x.close]);
    }
    const { z } = computeResMom({ closes, decisionBar: grid, lookbackBars: params.lookbackBars, betaBars: params.betaBars });
    const targets = targetPositions(z, params.longCount);
    if (!targets.length) {
      console.error(`[${resMom.name}] poucas moedas com pontuação (${Object.keys(z).length}); sem reequilíbrio`);
      return stats;
    }
    const target = new Map(targets.map((t) => [t.symbol, t]));
    const n = targets.length;

    // 1) Fecha as posições que saem do cabaz ou mudam de direção
    const open = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' } });
    const keep = new Set<string>();
    for (const sig of open) {
      const t = target.get(sig.symbol);
      if (t && t.direction === sig.direction) {
        keep.add(sig.symbol);
        await prisma.signal.update({ where: { id: sig.id }, data: { strength: strengthOf(t.z), lastCheckedAt: new Date() } });
        continue;
      }
      const price = priceOf.get(sig.symbol) ?? sig.entryPrice;
      const resultPct = ((price - sig.entryPrice) / sig.entryPrice) * 100 * (sig.direction === 'BUY' ? 1 : -1);
      const reason = !t
        ? 'Saiu do universo ou ficou sem pontuação'
        : `Reequilíbrio: passa a ${t.direction === 'BUY' ? 'long' : 'short'} (z ${t.z.toFixed(2)}, ${t.zRank}.º de ${n})`;
      const closed = await prisma.signal.update({
        where: { id: sig.id },
        data: { status: 'CLOSED', exitPrice: price, exitAt: new Date(), resultPct, exitReason: reason, lastCheckedAt: new Date() },
      });
      stats.closed++;
      if (canClose() && closed.execStatus && ['FILLED', 'PARTIAL'].includes(closed.execStatus)) await closePosition(closed, price);
    }

    // 2) Abre as que faltam
    const tradeEntries = await canOpen(strategy.tradingOn);
    for (const t of targets) {
      if (keep.has(t.symbol)) continue;
      const price = priceOf.get(t.symbol);
      if (!price || !Number.isFinite(price)) continue;
      const sizePct = (t.weightPct * params.capitalPct) / 100;
      const created = await prisma.signal.create({
        data: {
          symbol: t.symbol,
          direction: t.direction,
          timeframe: TF,
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice: price,
          strength: strengthOf(t.z),
          status: 'OPEN',
          barTime: new Date(grid),
          extraInfo: JSON.stringify({
            source: 'bybit',
            z: t.z,
            zRank: t.zRank,
            universeSize: n,
            weightPct: t.weightPct,
            sizePct,
            leverage: params.leverage,
            refPrice: price,
            rebalanceBar: grid,
          }),
        },
      });
      stats.opened++;
      if (tradeEntries) await openPosition(created);
    }
    stats.updated = keep.size;
    return stats;
  },
};
