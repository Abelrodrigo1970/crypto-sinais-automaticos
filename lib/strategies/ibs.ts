import type { StrategyDefinition } from './types';
import { SELECTED_STOCKS, STOCK_UNIVERSE } from './common';

type Params = { ibsMax: number; includeSymbols: string[]; excludeSymbols: string[] };

/**
 * Internal Bar Strength: compra quando fecha perto do mínimo do dia
 * e vende quando fecha acima do máximo da véspera.
 * Backtest 01/25–10/26 (43 ações): 2049 trades, WR 65%, PF 1.64.
 * Limiar 0,1 desde 30/10/2026: nas 29 ações selecionadas, 2020–out/2026, +1,26%/trade (0,2: +1,12%),
 * menos liquidações a 5x (169 vs 253) e 2022 quase plano (scratchpad ibs/ibs01.py).
 */
export const ibs: StrategyDefinition<Params> = {
  name: 'IBS',
  displayName: 'IBS < 0.1',
  description:
    'Compra no fecho quando IBS = (fecho − mínimo) / (máximo − mínimo) < 0,1. Vende no fecho em que o preço fecha acima do máximo da véspera. Sem stop. Velas diárias da ação subjacente.',
  timeframe: '1d',
  source: 'underlying',
  candleLimit: 60,
  universe: STOCK_UNIVERSE,
  defaultParams: { ibsMax: 0.1, includeSymbols: SELECTED_STOCKS, excludeSymbols: [] },

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
