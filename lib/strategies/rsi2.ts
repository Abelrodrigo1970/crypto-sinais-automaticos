import type { StrategyDefinition } from './types';
import { SELECTED_STOCKS, STOCK_UNIVERSE } from './common';
import { rsi, sma } from './series';

type Params = { rsiPeriod: number; rsiMax: number; trendPeriod: number; exitPeriod: number; includeSymbols: string[]; excludeSymbols: string[] };

/**
 * Connors RSI-2: compra quedas curtas em tendência de subida e sai no primeiro ressalto.
 * Backtest 01/25–10/26 (40 ações): 485 trades, WR 68%, PF 1.94, DD carteira -9.5%.
 */
export const rsi2: StrategyDefinition<Params> = {
  name: 'RSI2',
  displayName: 'Connors RSI-2',
  description:
    'Compra no fecho quando o preço está acima da SMA200 e o RSI(2) < 10. Vende no fecho em que o preço fecha acima da SMA5. Sem stop. Velas diárias da ação subjacente.',
  timeframe: '1d',
  source: 'underlying',
  candleLimit: 260,
  universe: STOCK_UNIVERSE,
  defaultParams: { rsiPeriod: 2, rsiMax: 10, trendPeriod: 200, exitPeriod: 5, includeSymbols: SELECTED_STOCKS, excludeSymbols: [] },

  evaluate({ candles, params }) {
    const closes = candles.map((c) => c.close);
    const i = closes.length - 1;
    const trend = sma(closes, params.trendPeriod)[i];
    const r = rsi(closes, params.rsiPeriod)[i];
    if (!(closes[i] > trend) || !(r < params.rsiMax)) return null;
    return {
      direction: 'BUY',
      strength: Math.round(70 + (params.rsiMax - r) * 2),
      info: { rsi2: r, sma200: trend },
    };
  },

  manage({ candles, params }) {
    const closes = candles.map((c) => c.close);
    const i = closes.length - 1;
    const exitMa = sma(closes, params.exitPeriod)[i];
    if (closes[i] > exitMa) {
      return { exit: true, reason: `Fecho ${closes[i].toFixed(2)} acima da SMA${params.exitPeriod} ${exitMa.toFixed(2)}` };
    }
    return { exit: false };
  },
};
