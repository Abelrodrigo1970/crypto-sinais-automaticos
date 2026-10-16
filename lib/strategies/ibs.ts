import type { StrategyDefinition } from './types';
import { BACKTEST_EXCLUDED, STOCK_UNIVERSE } from './common';

type Params = { ibsMax: number; excludeSymbols: string[] };

/**
 * Internal Bar Strength: compra quando fecha perto do mínimo do dia
 * e vende quando fecha acima do máximo da véspera.
 * Backtest 01/25–10/26 (43 ações): 2049 trades, WR 65%, PF 1.64.
 */
export const ibs: StrategyDefinition<Params> = {
  name: 'IBS',
  displayName: 'IBS < 0.2',
  description:
    'Compra no fecho quando IBS = (fecho − mínimo) / (máximo − mínimo) < 0,2. Vende no fecho em que o preço fecha acima do máximo da véspera. Sem stop. Velas diárias da ação subjacente.',
  timeframe: '1d',
  source: 'underlying',
  candleLimit: 60,
  universe: STOCK_UNIVERSE,
  defaultParams: { ibsMax: 0.2, excludeSymbols: BACKTEST_EXCLUDED },

  evaluate({ candles, params }) {
    const c = candles[candles.length - 1];
    if (c.high <= c.low) return null;
    const value = (c.close - c.low) / (c.high - c.low);
    if (value >= params.ibsMax) return null;
    return { direction: 'BUY', strength: Math.round(70 + (params.ibsMax - value) * 100), info: { ibs: value } };
  },

  manage({ candles }) {
    const c = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (prev && c.close > prev.high) {
      return { exit: true, reason: `Fecho ${c.close.toFixed(2)} acima do máximo da véspera ${prev.high.toFixed(2)}` };
    }
    return { exit: false };
  },
};
