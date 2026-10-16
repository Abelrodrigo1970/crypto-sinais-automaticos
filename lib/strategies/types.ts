import type { AssetType, Candle, Timeframe, UniverseAsset } from '../marketData';

export type Direction = 'BUY' | 'SELL';

/**
 * Entrada devolvida por uma estratégia no fecho da última vela.
 * Preços nas unidades das velas usadas (subjacente ou Bybit); o motor converte para o preço Bybit.
 */
export interface StrategySignal {
  direction: Direction;
  /** Stop inicial; omitir quando a estratégia não usa stop */
  stopLoss?: number;
  target1?: number;
  target2?: number;
  target3?: number;
  /** 0-100 */
  strength: number;
  /** Detalhes do cálculo (guardado em Signal.extraInfo) */
  info?: Record<string, unknown>;
}

/** Posição aberta, tal como o motor a passa a manage() */
export interface OpenPosition {
  direction: Direction;
  /** Abertura (ms) da vela em cujo fecho se entrou */
  entryBarTime: number;
  /** Fecho dessa vela, nas unidades das velas */
  entryRefPrice: number;
}

export interface ExitDecision {
  exit: boolean;
  reason?: string;
  /** Stop atualizado (ex.: trailing), nas unidades das velas */
  stopLoss?: number | null;
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
  /**
   * De onde vêm as velas: 'bybit' (perpétuo) ou 'underlying' (ação subjacente, sessão regular,
   * ajustada a splits; é o que os backtests usaram).
   */
  source: 'bybit' | 'underlying';
  /** Quantas velas fechadas a estratégia precisa */
  candleLimit: number;
  /** Universo: tipos de ativo e liquidez mínima (turnover 24h em USDT) */
  universe?: { types?: AssetType[]; minTurnover24h?: number };
  /** Parâmetros por omissão; os da BD (editáveis na UI) sobrepõem-se. `excludeSymbols` retira ativos do universo. */
  defaultParams: P;
  /** Entrada no fecho da última vela (só é chamada sem posição aberta nesse símbolo) */
  evaluate(ctx: StrategyContext<P>): StrategySignal | null;
  /** Gestão da posição aberta no fecho da última vela: sair ou atualizar o stop */
  manage(ctx: StrategyContext<P>, position: OpenPosition): ExitDecision;
}
