import { prisma } from '../db';
import { fetchCandles, fetchCurrentPrice } from '../marketData';
import { fetchCryptoUniverse } from '../cryptoUniverse';
import { EXIT_RETRY_STATUSES, canClose, canOpen, closePosition, openPosition } from '../bybitTrading';
import { computePullback } from './pullbackCalc';
import type { PortfolioStrategyDefinition } from './types';

type Params = {
  /** Universo: top N por capitalização a 1 de janeiro do ano corrente */
  topN: number;
  /** Força própria mínima (z dos resíduos de 7 dias, do dia anterior) */
  zMin: number;
  /** Entra quando RSI(3) diário < rsiEntry */
  rsiEntry: number;
  /** Sai quando RSI(3) diário > rsiExit */
  rsiExit: number;
  /** % do saldo por trade */
  sizePct: number;
  /** Máximo de posições abertas desta estratégia */
  maxPositions: number;
  leverage: number;
  excludeSymbols: string[];
};

const DAY = 24 * 60 * 60_000;
/** Só entra se a vela diária de sinal fechou há menos disto (evita entradas atrasadas) */
const ENTRY_MAX_DELAY_MS = 22 * 60 * 60_000;

/**
 * Pullback em moeda forte (backtest top 25 anual, 2021–set/2026, scratchpad y30/t6–t10):
 * compra no fecho diário quando a moeda tem força própria (z7 de ontem > 0,5) e cai a pique (RSI3 < 20);
 * vende no fecho em que o RSI3 passa 50. Mediana de 4 dias, acerto ~70%.
 * Por trade vs entradas aleatórias: +4,4% (2021–23) / +2,5% (2024–26). Carteira 10%/trade: Sharpe 1,19, DD −18%.
 */
export const pullback: PortfolioStrategyDefinition<Params> = {
  kind: 'portfolio',
  name: 'PULLBACK_FORTE',
  displayName: 'Pullback em moeda forte (cripto top 25)',
  description:
    'Universo: top 25 por capitalização a 1 de janeiro (CoinMarketCap, sem stablecoins), perpétuos USDT da Bybit, velas diárias. ' +
    'Força própria: z7 = soma dos resíduos de 7 dias (retorno − beta × média do universo) ÷ (desvio-padrão de 30 dias × √7). ' +
    'Compra no fecho diário quando o z7 de ontem > 0,5 e o RSI(3) < 20; vende no fecho em que o RSI(3) > 50. Só long.',
  timeframe: '1d',
  defaultParams: {
    topN: 25,
    zMin: 0.5,
    rsiEntry: 20,
    rsiExit: 50,
    sizePct: 10,
    maxPositions: 10,
    leverage: 1,
    excludeSymbols: [],
  },

  async run({ strategy, params }) {
    const stats = { opened: 0, closed: 0, updated: 0 };
    const exclude = new Set(params.excludeSymbols ?? []);
    const universe = (await fetchCryptoUniverse(params.topN)).filter((a) => !exclude.has(a.symbol));
    const priceOf = new Map(universe.map((a) => [a.symbol, a.lastPrice]));
    const open = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' } });

    if (canClose()) {
      const retries = await prisma.signal.findMany({
        where: { strategyId: strategy.id, status: 'CLOSED', execStatus: { in: EXIT_RETRY_STATUSES } },
      });
      for (const sig of retries) await closePosition(sig, priceOf.get(sig.symbol) ?? sig.exitPrice ?? sig.entryPrice);
    }

    // Velas diárias do universo + das moedas com posição que já saíram do universo
    const symbols = Array.from(new Set([...universe.map((a) => a.symbol), ...open.map((s) => s.symbol)]));
    const loaded = await Promise.all(
      symbols.map((s) =>
        fetchCandles(s, '1d', 120)
          .then((c) => [s, c] as const)
          .catch((error) => {
            console.error(`[${pullback.name}] sem velas de ${s}:`, error instanceof Error ? error.message : error);
            return [s, null] as const;
          })
      )
    );
    const failed = loaded.filter(([s, c]) => c === null && priceOf.has(s)).map(([s]) => s);
    if (failed.length) {
      // a média do mercado ficaria diferente da do backtest
      console.error(`[${pullback.name}] corrida adiada: faltam velas de ${failed.join(', ')}`);
      return stats;
    }
    const closes: Record<string, Array<[number, number]>> = {};
    for (const [s, c] of loaded) {
      if (c && c.length >= 31) closes[s] = c.map((x) => [x.timestamp, x.close]);
    }
    const lastBar = Math.max(...Object.values(closes).map((c) => c[c.length - 1][0]));
    const st = computePullback({ closes, universe: universe.map((a) => a.symbol).filter((s) => closes[s]), lastBar });
    const barTime = new Date(lastBar);

    // 1) Saídas: RSI3 > rsiExit no fecho da última vela (posterior à de entrada)
    for (const sig of open) {
      const r = st.rsi3[sig.symbol];
      if (r === undefined || !sig.barTime || sig.barTime.getTime() >= lastBar || r <= params.rsiExit) {
        stats.updated++;
        continue;
      }
      const price = priceOf.get(sig.symbol) ?? (await fetchCurrentPrice(sig.symbol));
      const resultPct = ((price - sig.entryPrice) / sig.entryPrice) * 100;
      const closed = await prisma.signal.update({
        where: { id: sig.id },
        data: {
          status: 'CLOSED',
          exitPrice: price,
          exitAt: new Date(),
          resultPct,
          exitReason: `RSI(3) ${r.toFixed(1)} > ${params.rsiExit} no fecho diário`,
          lastCheckedAt: new Date(),
        },
      });
      stats.closed++;
      if (canClose() && closed.execStatus && ['FILLED', 'PARTIAL'].includes(closed.execStatus)) await closePosition(closed, price);
    }

    // 2) Entradas: só logo a seguir ao fecho da vela diária
    if (Date.now() - (lastBar + DAY) > ENTRY_MAX_DELAY_MS) return stats;
    const stillOpen = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' }, select: { symbol: true } });
    const busy = new Set(stillOpen.map((s) => s.symbol));
    let openCount = stillOpen.length;
    const tradeEntries = await canOpen(strategy.tradingOn);
    const candidates = universe
      .filter((a) => !busy.has(a.symbol))
      .map((a) => ({ a, z: st.zPrev[a.symbol], r: st.rsi3[a.symbol] }))
      .filter((x) => x.z !== undefined && x.r !== undefined && x.z > params.zMin && x.r < params.rsiEntry)
      .sort((x, y) => x.r - y.r);
    for (const { a, z, r } of candidates) {
      if (openCount >= params.maxPositions) break;
      const already = await prisma.signal.findFirst({ where: { strategyId: strategy.id, symbol: a.symbol, barTime }, select: { id: true } });
      if (already) continue;
      const price = a.lastPrice;
      if (!price || !Number.isFinite(price)) continue;
      const created = await prisma.signal.create({
        data: {
          symbol: a.symbol,
          direction: 'BUY',
          timeframe: '1d',
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice: price,
          strength: Math.round(60 + Math.min(40, (params.rsiEntry - r) * 2)),
          status: 'OPEN',
          barTime,
          extraInfo: JSON.stringify({
            source: 'bybit',
            z7: z,
            rsi3: r,
            refPrice: st.close[a.symbol],
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
