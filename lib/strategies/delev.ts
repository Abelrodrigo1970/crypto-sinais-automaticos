import { prisma } from '../db';
import { fetchCurrentPrice } from '../marketData';
import { fetchCryptoUniverse } from '../cryptoUniverse';
import { fetchHourlyDerivs } from '../bybitDerivs';
import { EXIT_RETRY_STATUSES, canClose, canOpen, closePosition, openPosition } from '../bybitTrading';
import { computeDelev } from './delevCalc';
import type { PortfolioStrategyDefinition } from './types';

type Params = {
  topN: number;
  /** Mínimo de condições (das 5) ao mesmo tempo */
  minConds: number;
  /** Horas até à saída */
  holdHours: number;
  sizePct: number;
  maxPositions: number;
  leverage: number;
  excludeSymbols: string[];
};

const HOUR = 3_600_000;
/** Só entra se a vela de sinal fechou há menos disto (o cron corre de hora a hora) */
const ENTRY_MAX_DELAY_MS = 70 * 60_000;

const LABEL: Record<string, string> = {
  squeeze: 'squeeze (preço ↑, OI ↓)',
  liquidacoes: 'liquidações (preço ↓, OI ↓)',
  oi24: 'OI 24h em queda extrema',
  capitulacao: 'capitulação (mín. 24h, OI ↓)',
  premio: 'prémio do perpétuo muito negativo',
};

/**
 * Alavancagem desfeita (backtest top 25 anual 2021–set/2026, y30/delev_y30.py): em velas de 1h, long 12h quando
 * ≥3 de 5 condições de desalavancagem disparam ao mesmo tempo. Por trade vs entradas aleatórias: +0,66% (2021–23)
 * / +2,25% (2024–26). Carteira 10%/trade: 10 000 → 20 040 USD (mar/2021–set/2026), Sharpe 1,41.
 */
export const delev: PortfolioStrategyDefinition<Params> = {
  kind: 'portfolio',
  name: 'ALAVANCAGEM_DESFEITA',
  displayName: 'Alavancagem desfeita (cripto top 25, 1h)',
  description:
    'Universo: top 25 por capitalização a 1 de janeiro, perpétuos USDT da Bybit, velas de 1h. Condições (z de 7 dias): ' +
    'squeeze (preço z>1,5 e OI z<−1,5), liquidações (preço z<−1,5 e OI z<−1,5), OI de 24h em queda extrema (z<−2 vs 30 dias), ' +
    'capitulação (novo mínimo de 24h com OI de 24h z<−1), prémio do perpétuo z<−2. ' +
    'Compra no fecho da hora quando ≥3 disparam; vende 12 horas depois. Só long.',
  timeframe: '1h',
  defaultParams: { topN: 25, minConds: 3, holdHours: 12, sizePct: 10, maxPositions: 10, leverage: 1, excludeSymbols: [] },

  async run({ strategy, params }) {
    const stats = { opened: 0, closed: 0, updated: 0 };
    const exclude = new Set(params.excludeSymbols ?? []);
    const universe = (await fetchCryptoUniverse(params.topN)).filter((a) => !exclude.has(a.symbol));
    const priceOf = new Map(universe.map((a) => [a.symbol, a.lastPrice]));

    if (canClose()) {
      const retries = await prisma.signal.findMany({
        where: { strategyId: strategy.id, status: 'CLOSED', execStatus: { in: EXIT_RETRY_STATUSES } },
      });
      for (const sig of retries) await closePosition(sig, priceOf.get(sig.symbol) ?? sig.exitPrice ?? sig.entryPrice);
    }

    // 1) Saídas: 12 horas depois do fecho da vela de entrada
    const open = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' } });
    for (const sig of open) {
      if (!sig.barTime || Date.now() < sig.barTime.getTime() + HOUR + params.holdHours * HOUR) {
        stats.updated++;
        continue;
      }
      const price = priceOf.get(sig.symbol) ?? (await fetchCurrentPrice(sig.symbol));
      const resultPct = ((price - sig.entryPrice) / sig.entryPrice) * 100;
      const closed = await prisma.signal.update({
        where: { id: sig.id },
        data: { status: 'CLOSED', exitPrice: price, exitAt: new Date(), resultPct, exitReason: `${params.holdHours}h depois da entrada`, lastCheckedAt: new Date() },
      });
      stats.closed++;
      if (canClose() && closed.execStatus && ['FILLED', 'PARTIAL'].includes(closed.execStatus)) await closePosition(closed, price);
    }

    // 2) Entradas na última vela de 1h fechada
    const lastBar = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
    if (Date.now() - (lastBar + HOUR) > ENTRY_MAX_DELAY_MS) return stats;
    const stillOpen = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' }, select: { symbol: true } });
    const busy = new Set(stillOpen.map((s) => s.symbol));
    let openCount = stillOpen.length;
    if (openCount >= params.maxPositions) return stats;
    const tradeEntries = await canOpen(strategy.tradingOn);
    const barTime = new Date(lastBar);

    for (const a of universe) {
      if (busy.has(a.symbol) || openCount >= params.maxPositions) continue;
      let st;
      try {
        st = computeDelev(await fetchHourlyDerivs(a.symbol, 1000));
      } catch (error) {
        console.error(`[${delev.name}] sem dados de ${a.symbol}:`, error instanceof Error ? error.message : error);
        continue;
      }
      if (!st || st.t !== lastBar || st.n < params.minConds) continue;
      const already = await prisma.signal.findFirst({ where: { strategyId: strategy.id, symbol: a.symbol, barTime }, select: { id: true } });
      if (already) continue;
      const price = a.lastPrice;
      if (!price || !Number.isFinite(price)) continue;
      const fired = Object.entries(st.conds).filter(([, v]) => v).map(([k]) => LABEL[k]);
      const created = await prisma.signal.create({
        data: {
          symbol: a.symbol,
          direction: 'BUY',
          timeframe: '1h',
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice: price,
          strength: Math.min(100, 60 + st.n * 8),
          status: 'OPEN',
          barTime,
          extraInfo: JSON.stringify({
            source: 'bybit',
            condicoes: fired,
            n: st.n,
            ...st.z,
            refPrice: st.close,
            sizePct: params.sizePct,
            leverage: params.leverage,
            barTime: lastBar,
          }),
        },
      });
      stats.opened++;
      openCount++;
      if (tradeEntries) await openPosition(created);
    }
    return stats;
  },
};
