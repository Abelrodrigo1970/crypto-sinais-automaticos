import type { AssetType, Candle, Timeframe, UniverseAsset } from '../marketData';

export type Direction = 'BUY' | 'SELL';

/** Sinal devolvido por uma estratégia para um símbolo (preços absolutos). */
export interface StrategySignal {
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  target1?: number;
  target2?: number;
  target3?: number;
  /** 0-100 */
  strength: number;
  /** Detalhes do cálculo (guardado em Signal.extraInfo) */
  info?: Record<string, unknown>;
}

export interface StrategyContext<P> {
  symbol: string;
  asset: UniverseAsset;
  /** Velas fechadas do timeframe da estratégia, mais antiga primeiro */
  candles: Candle[];
  params: P;
}

export interface StrategyDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Código único, guardado em Strategy.name */
  name: string;
  displayName: string;
  description: string;
  timeframe: Timeframe;
  /** Quantas velas fechadas a estratégia precisa */
  candleLimit: number;
  /** Universo: tipos de ativo e liquidez mínima (turnover 24h em USDT) */
  universe?: { types?: AssetType[]; minTurnover24h?: number };
  /** Parâmetros por omissão; os da BD (editáveis na UI) sobrepõem-se */
  defaultParams: P;
  /** Não repetir o mesmo sinal (símbolo+direção) dentro desta janela */
  cooldownHours?: number;
  evaluate(ctx: StrategyContext<P>): StrategySignal | null;
}
