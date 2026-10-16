import type { AssetType } from '../marketData';

/**
 * As 29 ações selecionadas no backtest de 01/01/2025 a 15/10/2026: só ações (sem ETFs),
 * sem as 12 com retorno negativo em 2+ estratégias, e com as 4 estratégias testadas
 * (SPCX e PURR ficaram de fora por não terem 200 dias de histórico).
 * Editável por estratégia em `params.includeSymbols` (lista vazia = todo o universo).
 */
export const SELECTED_STOCKS = [
  'AAOIUSDT', 'AAPLUSDT', 'AMDSTOCKUSDT', 'AMZNUSDT', 'AVGOUSDT', 'AXTIUSDT', 'BEUSDT', 'BMNRUSDT',
  'DELLUSDT', 'GOOGLUSDT', 'HOODUSDT', 'INTCUSDT', 'LITEUSDT', 'MRNAUSDT', 'MRVLUSDT', 'MSFTUSDT',
  'MUUSDT', 'NBISUSDT', 'NVDAUSDT', 'PENGSTOCKUSDT', 'PLTRUSDT', 'POETUSDT', 'RKLBUSDT', 'SAMSUNGUSDT',
  'SKHYNIXUSDT', 'SNDKUSDT', 'TSEMUSDT', 'TSMUSDT', 'WDCUSDT',
];

/** Universo dos backtests: só ações, com mais de 1M USDT de volume em 24h */
export const STOCK_UNIVERSE: { types: AssetType[]; minTurnover24h: number } = {
  types: ['stock'],
  minTurnover24h: 1_000_000,
};

/** Índice da vela de entrada (ou -1 se já não estiver nas velas carregadas) */
export function barIndex(candles: { timestamp: number }[], time: number): number {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].timestamp === time) return i;
    if (candles[i].timestamp < time) return -1;
  }
  return -1;
}
