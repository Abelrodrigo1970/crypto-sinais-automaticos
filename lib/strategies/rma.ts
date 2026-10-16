import type { StrategyDefinition } from './types';
import { SELECTED_STOCKS, STOCK_UNIVERSE, barIndex } from './common';
import { atr, ema, kama, rollingStd, sma } from './series';

type Params = { kamaPeriod: number; fastEma: number; bandPeriod: number; atrPeriod: number; atrStop: number; regimeSma: number; includeSymbols: string[]; excludeSymbols: string[] };

/**
 * Relative Momentum Accel (ali-azary/Algorithmic-Trading-From-Beginner-to-Advanced), só long.
 * Impulso = (EMA7 − KAMA30) / KAMA30; entra quando sai acima da banda de Bollinger(7, 1σ) do impulso.
 * Backtest 01/25–10/26 (43 ações): 522 trades, WR 40%, trade médio +9%, PF 2.47.
 * Só entra com o QQQ acima da SMA50 (variante B): DD da carteira -40% → -28% em 2019–24.
 */
export const rma: StrategyDefinition<Params> = {
  name: 'RMA',
  displayName: 'Rel. Momentum Accel',
  description:
    'Compra no fecho quando o impulso (EMA7 − KAMA30) / KAMA30 fica acima da sua média de 7 dias + 1 desvio-padrão, só com o QQQ acima da SMA50 diária. Trailing stop: máximo desde a entrada − 3×ATR(7), verificado no fecho. Velas diárias da ação subjacente.',
  timeframe: '1d',
  source: 'underlying',
  candleLimit: 120,
  needsMarket: true,
  universe: STOCK_UNIVERSE,
  defaultParams: { kamaPeriod: 30, fastEma: 7, bandPeriod: 7, atrPeriod: 7, atrStop: 3, regimeSma: 50, includeSymbols: SELECTED_STOCKS, excludeSymbols: [] },

  evaluate({ candles, params, market }) {
    // Filtro de regime: sem dados do QQQ não entra; regimeSma = 0 desliga o filtro
    if (params.regimeSma > 0) {
      const q = market?.qqq.map((c) => c.close) ?? [];
      if (q.length < params.regimeSma) return null;
      const qSma = sma(q, params.regimeSma)[q.length - 1];
      if (!(q[q.length - 1] > qSma)) return null;
    }
    const closes = candles.map((c) => c.close);
    const k = kama(closes, params.kamaPeriod);
    const e = ema(closes, params.fastEma);
    const thrust = closes.map((_, i) => (e[i] - k[i]) / (k[i] + 1e-6));
    const mean = sma(thrust, params.bandPeriod);
    const sd = rollingStd(thrust, params.bandPeriod);
    const i = closes.length - 1;
    if (!(thrust[i] > mean[i] + sd[i])) return null;
    const a = atr(candles, params.atrPeriod)[i];
    return {
      direction: 'BUY',
      stopLoss: closes[i] - params.atrStop * a,
      strength: 70,
      info: { thrust: thrust[i], band: mean[i] + sd[i], atr: a },
    };
  },

  manage({ candles, params }, position) {
    const start = barIndex(candles, position.entryBarTime);
    if (start < 0) return { exit: false };
    const a = atr(candles, params.atrPeriod);
    // Mesmo trailing do backtest: extremo começa no fecho de entrada, sobe com os máximos seguintes
    let ext = candles[start].close;
    let stop = NaN;
    for (let i = start + 1; i < candles.length; i++) {
      ext = Math.max(ext, candles[i].high);
      const next = ext - params.atrStop * a[i];
      stop = Number.isNaN(stop) ? next : Math.max(stop, next);
      if (candles[i].close < stop) {
        return {
          exit: true,
          reason: `Fecho ${candles[i].close.toFixed(2)} abaixo do trailing stop ${stop.toFixed(2)}`,
          stopLoss: stop,
        };
      }
    }
    return { exit: false, stopLoss: Number.isNaN(stop) ? undefined : stop };
  },
};
