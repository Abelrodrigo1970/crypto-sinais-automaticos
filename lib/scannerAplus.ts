/**
 * Scanner de Trades A+ para Binance USDT-M Futures Perpetual
 * 
 * Implementa:
 * - Setup TREND_PULLBACK (principal)
 * - Setup BREAKOUT_RETEST (opcional)
 * - Sistema de score 0-10
 * - Filtros anti-trade ruim
 * - Gestão de risco
 */

import { fetchCandles, fetchTopSymbolsByVolume, type Candle } from './marketData';
import {
  calculateEMA,
  calculateATR,
  calculateRSI,
  calculateVolumeMA,
  getCloses,
  getVolumes,
  getHighestHigh,
  getLowestLow,
} from './indicators';

export interface ScannerConfig {
  // Filtros de liquidez
  topSymbolsLimit: number;
  minQuoteVolume: number;
  
  // Filtros de volatilidade
  minATRPercent: number; // 0.3% padrão
  maxATRPercent: number; // 2.5% padrão
  
  // Score mínimo para ENTRY
  minEntryScore: number; // 7 padrão
  
  // Top N alertas para retornar
  topNAlerts: number; // 3 padrão
  
  // Setup BREAKOUT_RETEST
  enableBreakoutRetest: boolean;
  breakoutPeriod: number; // 48 padrão
  
  // Cooldown (minutos)
  cooldownMinutes: number; // 60 padrão
  
  // Controle de rate limit
  requestDelayMs: number; // Delay entre requisições (padrão: 500ms)
  maxRetries: number; // Máximo de tentativas em caso de erro (padrão: 3)
}

export interface Alert {
  symbol: string;
  side: 'LONG' | 'SHORT';
  setup: 'TREND_PULLBACK' | 'BREAKOUT_RETEST';
  alert_type: 'PRE-SETUP' | 'ENTRY';
  timeframe: string;
  score: number;
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  atr_pct_15m: number;
  reasons: string[];
  timestamp: number;
}

export interface MarketData {
  candles1h: Candle[];
  candles15m: Candle[];
  ema200_1h: number | null;
  ema200_1h_10barsAgo: number | null;
  ema21_1h: number | null;
  ema21_15m: number | null;
  atr14_1h: number | null;
  atr14_15m: number | null;
  rsi14_15m: number | null;
  volumeMA20_15m: number | null;
  currentPrice: number;
}

/**
 * Busca e calcula todos os indicadores necessários para um símbolo
 */
export async function fetchMarketData(symbol: string): Promise<MarketData | null> {
  try {
    // Buscar candles
    const candles1h = await fetchCandles(symbol, '1h', 300);
    const candles15m = await fetchCandles(symbol, '15m', 300);

    if (candles1h.length < 300 || candles15m.length < 300) {
      return null;
    }

    const closes1h = getCloses(candles1h);
    const closes15m = getCloses(candles15m);
    const volumes15m = getVolumes(candles15m);

    // Calcular indicadores 1H
    const ema200_1h_array = calculateEMA(closes1h, 200);
    const ema21_1h_array = calculateEMA(closes1h, 21);
    const atr14_1h = calculateATR(candles1h, 14);

    // Calcular indicadores 15m
    const ema21_15m_array = calculateEMA(closes15m, 21);
    const atr14_15m = calculateATR(candles15m, 14);
    const rsi14_15m = calculateRSI(closes15m, 14);
    const volumeMA20_15m = calculateVolumeMA(volumes15m, 20);

    // Validações
    if (
      !ema200_1h_array ||
      !ema21_1h_array ||
      !ema21_15m_array ||
      atr14_1h === null ||
      atr14_15m === null ||
      rsi14_15m === null ||
      volumeMA20_15m === null
    ) {
      return null;
    }

    const ema200_1h = ema200_1h_array[ema200_1h_array.length - 1];
    const ema200_1h_10barsAgo =
      ema200_1h_array.length >= 10
        ? ema200_1h_array[ema200_1h_array.length - 10]
        : null;
    const ema21_1h = ema21_1h_array[ema21_1h_array.length - 1];
    const ema21_15m = ema21_15m_array[ema21_15m_array.length - 1];

    const currentPrice = candles15m[candles15m.length - 1].close;

    return {
      candles1h,
      candles15m,
      ema200_1h,
      ema200_1h_10barsAgo,
      ema21_1h,
      ema21_15m,
      atr14_1h,
      atr14_15m,
      rsi14_15m,
      volumeMA20_15m,
      currentPrice,
    };
  } catch (error) {
    console.error(`Erro ao buscar dados de mercado para ${symbol}:`, error);
    return null;
  }
}

/**
 * Verifica filtros anti-trade ruim
 */
export function checkAntiTradeFilters(
  data: MarketData,
  config: ScannerConfig
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Filtro de volatilidade
  if (data.atr14_15m === null || data.atr14_15m === undefined) {
    reasons.push('ATR14_15m não disponível');
    return { passed: false, reasons };
  }

  const atr14_15m: number = data.atr14_15m;
  const atrPercent15m = (atr14_15m / data.currentPrice) * 100;

  if (atrPercent15m < config.minATRPercent) {
    reasons.push(`ATR% muito baixo: ${atrPercent15m.toFixed(2)}%`);
    return { passed: false, reasons };
  }

  if (atrPercent15m > config.maxATRPercent) {
    reasons.push(`ATR% muito alto: ${atrPercent15m.toFixed(2)}%`);
    return { passed: false, reasons };
  }

  return { passed: true, reasons };
}

/**
 * Detecta regime (tendência) no timeframe 1H
 */
export function detectRegime(data: MarketData): {
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasons: string[];
} {
  const reasons: string[] = [];
  let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';

  if (data.ema200_1h === null || data.ema200_1h_10barsAgo === null) {
    return { trend, reasons };
  }

  const close1h = data.candles1h[data.candles1h.length - 1].close;
  const ema200_1h: number = data.ema200_1h;
  const ema200_1h_10barsAgo: number = data.ema200_1h_10barsAgo;

  // LONG permitido se Close(1H) > EMA200(1H) e EMA200 inclinada para cima
  if (close1h > ema200_1h) {
    if (ema200_1h > ema200_1h_10barsAgo) {
      trend = 'BULLISH';
      reasons.push('1H>EMA200', 'EMA200 slope up');
    } else {
      reasons.push('1H>EMA200 mas EMA200 não inclinada');
    }
  }

  // SHORT permitido se Close(1H) < EMA200(1H) e EMA200 inclinada para baixo
  if (close1h < ema200_1h) {
    if (ema200_1h < ema200_1h_10barsAgo) {
      trend = 'BEARISH';
      reasons.push('1H<EMA200', 'EMA200 slope down');
    } else {
      reasons.push('1H<EMA200 mas EMA200 não inclinada');
    }
  }

  return { trend, reasons };
}

/**
 * Verifica se o preço está "na zona" (próximo da EMA21 1H)
 */
export function checkInZone(data: MarketData): {
  inZone: boolean;
  distance: number;
} {
  if (data.ema21_1h === null) {
    return { inZone: false, distance: Infinity };
  }

  const close1h = data.candles1h[data.candles1h.length - 1].close;
  const ema21_1h: number = data.ema21_1h;
  const distance = Math.abs(close1h - ema21_1h);
  const atr14_1h = data.atr14_1h ?? 0;
  const threshold = 0.5 * atr14_1h;

  return {
    inZone: distance <= threshold,
    distance,
  };
}

/**
 * Detecta setup TREND_PULLBACK
 */
export function detectTrendPullback(
  data: MarketData,
  config: ScannerConfig
): Alert | null {
  const regime = detectRegime(data);
  const zone = checkInZone(data);
  const filters = checkAntiTradeFilters(data, config);

  if (!filters.passed) {
    return null;
  }

  const lastCandle15m = data.candles15m[data.candles15m.length - 1];
  const prevCandle15m = data.candles15m[data.candles15m.length - 2];
  const volume15m = lastCandle15m.volume;

  // PRE-SETUP: Regime OK + na zona + volatilidade OK
  if (regime.trend !== 'NEUTRAL' && zone.inZone) {
    const preSetupAlert: Alert = {
      symbol: '', // será preenchido depois
      side: regime.trend === 'BULLISH' ? 'LONG' : 'SHORT',
      setup: 'TREND_PULLBACK',
      alert_type: 'PRE-SETUP',
      timeframe: '15m',
      score: 5, // Score base para PRE-SETUP
      entry: data.currentPrice,
      stop: 0, // Será calculado se virar ENTRY
      t1: 0,
      t2: 0,
      atr_pct_15m: data.atr14_15m ? (data.atr14_15m / data.currentPrice) * 100 : 0,
      reasons: [...regime.reasons, 'near EMA21 1H'],
      timestamp: Date.now(),
    };

    // Verificar se pode virar ENTRY
    let entryScore = 0;
    const entryReasons: string[] = [...regime.reasons];

    // LONG entry
    if (regime.trend === 'BULLISH' && data.ema21_15m !== null) {
      const ema21_15m: number = data.ema21_15m;
      // Candle fecha acima da EMA21(15m) após pullback
      const wasBelow = prevCandle15m.close < ema21_15m;
      const nowAbove = lastCandle15m.close > ema21_15m;

      if (wasBelow && nowAbove) {
        entryReasons.push('15m close>EMA21 after pullback');
        entryScore += 2; // Gatilho claro

        // Volume acima da média (com bônus para volume muito alto)
        if (data.volumeMA20_15m !== null && volume15m > data.volumeMA20_15m) {
          entryReasons.push('vol>MA20');
          entryScore += 2;
          // Bônus para volume significativamente acima da média
          if (volume15m > data.volumeMA20_15m * 1.5) {
            entryReasons.push('vol>1.5xMA20');
            entryScore += 1;
          }
        }

        // RSI não esticado (mais rigoroso)
        if (data.rsi14_15m !== null) {
          if (data.rsi14_15m <= 65 && data.rsi14_15m >= 35) {
            entryReasons.push('RSI ideal range');
            entryScore += 2; // Aumentado de 1 para 2
          } else if (data.rsi14_15m <= 72 && data.rsi14_15m > 65) {
            entryReasons.push('RSI not overbought');
            entryScore += 1;
          } else {
            entryReasons.push('RSI too extreme');
            // Penalizar RSI muito extremo
            entryScore -= 1;
          }
        }

        // Calcular stop e targets (4% stop, 20% target)
        const stop = data.currentPrice * 0.96; // 4% abaixo
        const t1 = data.currentPrice * 1.20; // 20% acima
        const t2 = data.currentPrice * 1.20; // 20% acima (mesmo target)

        // Score por R:R (com 4% stop e 20% target, R:R = 5:1)
        entryReasons.push('RR=5:1');
        entryScore += 2;

        // Score por regime forte (melhorado)
        if (regime.trend === 'BULLISH' && data.ema200_1h !== null && data.ema200_1h_10barsAgo !== null) {
          const ema200_1h: number = data.ema200_1h;
          const ema200_1h_10barsAgo: number = data.ema200_1h_10barsAgo;
          const emaSlope = ((ema200_1h - ema200_1h_10barsAgo) / ema200_1h_10barsAgo) * 100;
          if (emaSlope > 0.15) {
            entryReasons.push('strong bullish trend');
            entryScore += 3; // Aumentado de 2 para 3 para tendências muito fortes
          } else if (emaSlope > 0.1) {
            entryReasons.push('bullish trend');
            entryScore += 2; // Regime forte
          }
        }

        // Score por zona limpa (melhorado - mais pontos se muito próximo)
        if (zone.inZone) {
          entryReasons.push('near EMA21 1H');
          entryScore += 2;
          // Bônus se muito próximo (dentro de 0.25 ATR)
          if (zone.distance <= (data.atr14_1h ?? 0) * 0.25) {
            entryReasons.push('very close to EMA21');
            entryScore += 1;
          }
        }

        // Garantir que o score nunca seja negativo
        entryScore = Math.max(0, entryScore);
        
        if (entryScore >= config.minEntryScore) {
          return {
            symbol: '', // será preenchido depois
            side: 'LONG',
            setup: 'TREND_PULLBACK',
            alert_type: 'ENTRY',
            timeframe: '15m',
            score: Math.min(10, Math.max(0, entryScore)),
            entry: data.currentPrice,
            stop,
            t1,
            t2,
            atr_pct_15m: data.atr14_15m ? (data.atr14_15m / data.currentPrice) * 100 : 0,
            reasons: entryReasons,
            timestamp: Date.now(),
          };
        }
      }
    }

    // SHORT entry
    if (regime.trend === 'BEARISH' && data.ema21_15m !== null) {
      const ema21_15m: number = data.ema21_15m;
      // Candle fecha abaixo da EMA21(15m)
      const wasAbove = prevCandle15m.close > ema21_15m;
      const nowBelow = lastCandle15m.close < ema21_15m;

      if (wasAbove && nowBelow) {
        entryReasons.push('15m close<EMA21');
        entryScore += 2; // Gatilho claro

        // Volume acima da média (com bônus para volume muito alto)
        if (data.volumeMA20_15m !== null && volume15m > data.volumeMA20_15m) {
          entryReasons.push('vol>MA20');
          entryScore += 2;
          // Bônus para volume significativamente acima da média
          if (volume15m > data.volumeMA20_15m * 1.5) {
            entryReasons.push('vol>1.5xMA20');
            entryScore += 1;
          }
        }

        // RSI não esticado (mais rigoroso)
        if (data.rsi14_15m !== null) {
          if (data.rsi14_15m >= 35 && data.rsi14_15m <= 65) {
            entryReasons.push('RSI ideal range');
            entryScore += 2; // Aumentado de 1 para 2
          } else if (data.rsi14_15m >= 28 && data.rsi14_15m < 35) {
            entryReasons.push('RSI not oversold');
            entryScore += 1;
          } else {
            entryReasons.push('RSI too extreme');
            // Penalizar RSI muito extremo
            entryScore -= 1;
          }
        }

        // Calcular stop e targets (4% stop, 20% target)
        // Para SHORT, stop deve estar ACIMA do preço de entrada
        const stop = data.currentPrice * 1.04; // 4% acima
        const t1 = data.currentPrice * 0.80; // 20% abaixo
        const t2 = data.currentPrice * 0.80; // 20% abaixo (mesmo target)

        // Score por R:R (com 4% stop e 20% target, R:R = 5:1)
        entryReasons.push('RR=5:1');
        entryScore += 2;

        // Score por regime forte (melhorado)
        if (regime.trend === 'BEARISH' && data.ema200_1h !== null && data.ema200_1h_10barsAgo !== null) {
          const ema200_1h: number = data.ema200_1h;
          const ema200_1h_10barsAgo: number = data.ema200_1h_10barsAgo;
          const emaSlope = ((ema200_1h - ema200_1h_10barsAgo) / ema200_1h_10barsAgo) * 100;
          if (emaSlope < -0.15) {
            entryReasons.push('strong bearish trend');
            entryScore += 3; // Aumentado de 2 para 3 para tendências muito fortes
          } else if (emaSlope < -0.1) {
            entryReasons.push('bearish trend');
            entryScore += 2; // Regime forte
          }
        }

        // Score por zona limpa (melhorado - mais pontos se muito próximo)
        if (zone.inZone) {
          entryReasons.push('near EMA21 1H');
          entryScore += 2;
          // Bônus se muito próximo (dentro de 0.25 ATR)
          if (zone.distance <= (data.atr14_1h ?? 0) * 0.25) {
            entryReasons.push('very close to EMA21');
            entryScore += 1;
          }
        }

        // Garantir que o score nunca seja negativo
        entryScore = Math.max(0, entryScore);
        
        if (entryScore >= config.minEntryScore) {
          return {
            symbol: '', // será preenchido depois
            side: 'SHORT',
            setup: 'TREND_PULLBACK',
            alert_type: 'ENTRY',
            timeframe: '15m',
            score: Math.min(10, Math.max(0, entryScore)),
            entry: data.currentPrice,
            stop,
            t1,
            t2,
            atr_pct_15m: data.atr14_15m ? (data.atr14_15m / data.currentPrice) * 100 : 0,
            reasons: entryReasons,
            timestamp: Date.now(),
          };
        }
      }
    }

    // Retornar PRE-SETUP se não virou ENTRY
    return preSetupAlert;
  }

  return null;
}

/**
 * Detecta setup BREAKOUT_RETEST
 */
export function detectBreakoutRetest(
  data: MarketData,
  config: ScannerConfig
): Alert | null {
  if (!config.enableBreakoutRetest) {
    return null;
  }

  const regime = detectRegime(data);
  const filters = checkAntiTradeFilters(data, config);

  if (!filters.passed || regime.trend === 'NEUTRAL') {
    return null;
  }

  const candles15m = data.candles15m;
  const lastCandle = candles15m[candles15m.length - 1];
  const volume15m = lastCandle.volume;

  // Buscar máxima/mínima das últimas N velas
  const lookback = Math.min(config.breakoutPeriod, candles15m.length - 1);
  const recentCandles = candles15m.slice(-lookback - 1, -1); // Excluir último candle
  const high = getHighestHigh(recentCandles, recentCandles.length);
  const low = getLowestLow(recentCandles, recentCandles.length);

  if (data.atr14_15m === null || data.atr14_15m === undefined) {
    return null;
  }

  const atr14_15m: number = data.atr14_15m;
  const tolerance = 0.3 * atr14_15m;
  let alert: Alert | null = null;

  // LONG: Breakout acima + reteste
  if (regime.trend === 'BULLISH' && data.volumeMA20_15m !== null) {
    // Verificar breakout
    if (lastCandle.close > high && volume15m > data.volumeMA20_15m) {
      // Verificar se houve reteste (preço voltou próximo ao nível)
      const retestCandles = candles15m.slice(-10);
      const retested = retestCandles.some(
        (c) => Math.abs(c.low - high) <= tolerance && c.close > high
      );

      if (retested || Math.abs(lastCandle.low - high) <= tolerance) {
        // Para LONG, stop e target fixos (4% stop, 20% target)
        const stop = data.currentPrice * 0.96; // 4% abaixo
        const t1 = data.currentPrice * 1.20; // 20% acima
        const t2 = data.currentPrice * 1.20; // 20% acima (mesmo target)

        // Calcular score dinâmico para BREAKOUT_RETEST
        let breakoutScore = 8; // Score base
        const breakoutReasons: string[] = ['breakout above resistance', 'retest confirmed', 'vol>MA20'];
        
        // Bônus para volume muito alto
        if (data.volumeMA20_15m !== null && volume15m > data.volumeMA20_15m * 1.5) {
          breakoutReasons.push('vol>1.5xMA20');
          breakoutScore += 1;
        }
        
        // Bônus para RSI ideal
        if (data.rsi14_15m !== null && data.rsi14_15m >= 50 && data.rsi14_15m <= 70) {
          breakoutReasons.push('RSI ideal for breakout');
          breakoutScore += 1;
        }

        // Aplicar filtro de score mínimo para BREAKOUT_RETEST também
        if (breakoutScore >= config.minEntryScore) {
          alert = {
            symbol: '', // será preenchido depois
            side: 'LONG',
            setup: 'BREAKOUT_RETEST',
            alert_type: 'ENTRY',
            timeframe: '15m',
            score: Math.min(10, Math.max(0, breakoutScore)),
            entry: data.currentPrice,
            stop,
            t1,
            t2,
            atr_pct_15m: data.atr14_15m ? (data.atr14_15m / data.currentPrice) * 100 : 0,
            reasons: breakoutReasons,
            timestamp: Date.now(),
          };
        }
      }
    }
  }

  // SHORT: Breakout abaixo + reteste
  if (regime.trend === 'BEARISH' && data.volumeMA20_15m !== null) {
    // Verificar breakout
    if (lastCandle.close < low && volume15m > data.volumeMA20_15m) {
      // Verificar se houve reteste (preço voltou próximo ao nível)
      const retestCandles = candles15m.slice(-10);
      const retested = retestCandles.some(
        (c) => Math.abs(c.high - low) <= tolerance && c.close < low
      );

      if (retested || Math.abs(lastCandle.high - low) <= tolerance) {
        // Para SHORT, stop e target fixos (4% stop, 20% target)
        const stop = data.currentPrice * 1.04; // 4% acima
        const t1 = data.currentPrice * 0.80; // 20% abaixo
        const t2 = data.currentPrice * 0.80; // 20% abaixo (mesmo target)

        // Calcular score dinâmico para BREAKOUT_RETEST
        let breakoutScore = 8; // Score base
        const breakoutReasons: string[] = ['breakout below support', 'retest confirmed', 'vol>MA20'];
        
        // Bônus para volume muito alto
        if (data.volumeMA20_15m !== null && volume15m > data.volumeMA20_15m * 1.5) {
          breakoutReasons.push('vol>1.5xMA20');
          breakoutScore += 1;
        }
        
        // Bônus para RSI ideal
        if (data.rsi14_15m !== null && data.rsi14_15m >= 30 && data.rsi14_15m <= 50) {
          breakoutReasons.push('RSI ideal for breakdown');
          breakoutScore += 1;
        }

        // Aplicar filtro de score mínimo para BREAKOUT_RETEST também
        if (breakoutScore >= config.minEntryScore) {
          alert = {
            symbol: '', // será preenchido depois
            side: 'SHORT',
            setup: 'BREAKOUT_RETEST',
            alert_type: 'ENTRY',
            timeframe: '15m',
            score: Math.min(10, Math.max(0, breakoutScore)),
            entry: data.currentPrice,
            stop,
            t1,
            t2,
            atr_pct_15m: data.atr14_15m ? (data.atr14_15m / data.currentPrice) * 100 : 0,
            reasons: breakoutReasons,
            timestamp: Date.now(),
          };
        }
      }
    }
  }

  return alert;
}

/**
 * Função principal do scanner
 */
export async function runScanner(
  config: Partial<ScannerConfig> = {}
): Promise<{
  entries: Alert[];
  preSetups: Alert[];
}> {
  const defaultConfig: ScannerConfig = {
    topSymbolsLimit: 50,
    minQuoteVolume: 0,
    minATRPercent: 0.3,
    maxATRPercent: 2.5,
    minEntryScore: 7,
    topNAlerts: 3,
    enableBreakoutRetest: false,
    breakoutPeriod: 48,
    cooldownMinutes: 60,
    requestDelayMs: 500,
    maxRetries: 3,
  };

  const finalConfig: ScannerConfig = { ...defaultConfig, ...config };

  // Buscar top símbolos
  const symbols = await fetchTopSymbolsByVolume(
    finalConfig.topSymbolsLimit,
    finalConfig.minQuoteVolume
  );

  const entries: Alert[] = [];
  const preSetups: Alert[] = [];
  const cooldownMap = new Map<string, number>(); // symbol -> timestamp do último alerta

  // Processar cada símbolo
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    let retries = 0;
    let success = false;

    while (retries < finalConfig.maxRetries && !success) {
      try {
        // Verificar cooldown
        const lastAlert = cooldownMap.get(symbol);
        if (lastAlert && Date.now() - lastAlert < finalConfig.cooldownMinutes * 60 * 1000) {
          success = true;
          continue;
        }

        // Buscar dados de mercado
        const data = await fetchMarketData(symbol);
        if (!data) {
          success = true; // Não é erro, apenas não há dados suficientes
          continue;
        }

        // Detectar setups
        const trendPullback = detectTrendPullback(data, finalConfig);
        const breakoutRetest = detectBreakoutRetest(data, finalConfig);

        // Processar alertas
        if (trendPullback) {
          trendPullback.symbol = symbol;
          if (trendPullback.alert_type === 'ENTRY') {
            entries.push(trendPullback);
            cooldownMap.set(symbol, Date.now());
          } else {
            preSetups.push(trendPullback);
          }
        }

        if (breakoutRetest) {
          breakoutRetest.symbol = symbol;
          entries.push(breakoutRetest);
          cooldownMap.set(symbol, Date.now());
        }

        success = true;
      } catch (error: any) {
        retries++;
        
        // Verificar se é erro de rate limit (429)
        const isRateLimit = error?.status === 429 || 
                           error?.message?.includes('429') ||
                           error?.message?.includes('rate limit');
        
        if (isRateLimit && retries < finalConfig.maxRetries) {
          // Backoff exponencial: 2s, 4s, 8s
          const backoffDelay = Math.min(2000 * Math.pow(2, retries - 1), 10000);
          console.warn(`Rate limit detectado para ${symbol}. Aguardando ${backoffDelay}ms antes de tentar novamente...`);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          continue;
        }
        
        if (retries >= finalConfig.maxRetries) {
          console.error(`Erro ao processar ${symbol} após ${retries} tentativas:`, error);
        } else {
          // Erro temporário, tentar novamente após delay normal
          await new Promise((resolve) => setTimeout(resolve, finalConfig.requestDelayMs));
        }
      }
    }

    // Delay entre símbolos (ajustado dinamicamente para 100+ símbolos)
    // Para 100 símbolos: delay reduzido para 300ms (ainda seguro)
    const delay = symbols.length > 75 
      ? Math.max(300, finalConfig.requestDelayMs * 0.6) 
      : finalConfig.requestDelayMs;
    
    // Não fazer delay no último símbolo
    if (i < symbols.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Ordenar por score e retornar top N
  entries.sort((a, b) => b.score - a.score);
  const topEntries = entries.slice(0, finalConfig.topNAlerts);

  return {
    entries: topEntries,
    preSetups: preSetups.slice(0, 10), // Top 10 PRE-SETUP
  };
}

// Função calculatePositionSize disponível em lib/riskManagement.ts

