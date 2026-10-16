import type { AssetType } from '../marketData';

/**
 * Ações excluídas por terem retorno negativo em 2+ das 4 estratégias no backtest
 * de 01/01/2025 a 15/10/2026. Editável por estratégia em `params.excludeSymbols`.
 */
export const BACKTEST_EXCLUDED = [
  'ARMUSDT', 'CBRSUSDT', 'COINUSDT', 'CRCLUSDT', 'CRWVUSDT', 'FLYUSDT',
  'IRENUSDT', 'METAUSDT', 'MSTRUSDT', 'ORCLUSDT', 'TSLAUSDT', 'WENSTOCKUSDT',
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
