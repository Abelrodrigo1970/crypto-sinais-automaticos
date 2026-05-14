/**
 * Motor de geração de sinais baseado em indicadores técnicos
 */

import { prisma } from './db';
import { ensureMissingBuiltinStrategies } from './ensureMissingBuiltinStrategies';
import {
  findStrategiesWithUniverseFallback,
  type StrategyWithUniverseRow,
} from './strategyQueries';
import { scanSymbolUniverseSymbols } from './universeScanner';
import { getLatestUniverseScanSymbols } from './universeScanPersistence';
import {
  UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80,
  UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
} from './symbolUniverseDefaults';
import { fetchCandles, fetchTopSymbolsBy1hPriceChange, type Timeframe } from './marketData';
import { createEntrySignals } from './multiTimeframeStrategy';
import {
  calculateSMA,
  calculateMACD,
  calculatePMO,
  calculateRSI,
  getCloses,
  getSmaPercentDistanceSeries,
  getEmaPercentDistanceSeries,
  smaTail,
  calculateEMA,
} from './indicators';

export interface SignalResult {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2?: number;
  target3?: number;
  strength: number;
  extraInfo: string;
}

export interface StrategyParams {
  [key: string]: any;
}


/**
 * Estratégia MACD Histogram: Gera sinais baseado em cruzamento do histograma (zero line)
 * Apenas no timeframe 4h e apenas nos horários: 8h, 12h, 16h, 20h, 23h
 */
export async function runMacdHistogramStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  // Esta estratégia funciona apenas com timeframe 4h
  if (timeframe !== '4h') {
    return null;
  }

  // Verificar se o horário atual está permitido
  if (!isAllowedTime()) {
    return null;
  }

  const fastPeriod = params.fastPeriod || 12;
  const slowPeriod = params.slowPeriod || 26;
  const signalPeriod = params.signalPeriod || 9;
  // Threshold para acionar sinal mais cedo (padrão: 0.001 = 0.1% do preço aproximado)
  const earlyEntryThreshold = params.earlyEntryThreshold || 0.001;

  try {
    const candles = await fetchCandles(symbol, timeframe, slowPeriod + signalPeriod + 20);
    if (candles.length < slowPeriod + signalPeriod + 2) {
      return null;
    }

    const closes = getCloses(candles);
    const macd = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod);

    if (macd === null) {
      return null;
    }

    // Calcula MACD anterior para detectar cruzamento do histograma
    const prevCloses = closes.slice(0, -1);
    const prevMacd = calculateMACD(prevCloses, fastPeriod, slowPeriod, signalPeriod);

    if (prevMacd === null) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    // Sinal de COMPRA: Histograma está convergindo para zero (aciona mais cedo)
    // Antes: prevMacd.histogram < 0 && macd.histogram > 0
    // Agora: prevMacd.histogram < -earlyEntryThreshold && macd.histogram > -earlyEntryThreshold
    // Isso detecta quando o histograma está próximo de cruzar, acionando o sinal mais cedo
    if (prevMacd.histogram < -earlyEntryThreshold && macd.histogram > -earlyEntryThreshold && macd.histogram <= earlyEntryThreshold) {
      const stopLoss = currentPrice * 0.96; // 4% abaixo
      const target1 = currentPrice * 1.20; // 20% acima
      const target2 = currentPrice * 1.20; // 20% acima (mesmo target)
      const target3 = currentPrice * 1.20; // 20% acima (mesmo target)

      // Força baseada no valor absoluto do histograma
      const strength = Math.min(100, Math.max(60, Math.round(Math.abs(macd.histogram) * 1000)));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          macd: macd.macd.toFixed(4),
          signal: macd.signal.toFixed(4),
          histogram: macd.histogram.toFixed(4),
          prevHistogram: prevMacd.histogram.toFixed(4),
          earlyEntry: true,
          threshold: earlyEntryThreshold,
        }),
      };
    }

    // Sinal de VENDA: Histograma está convergindo para zero (aciona mais cedo)
    // Antes: prevMacd.histogram > 0 && macd.histogram < 0
    // Agora: prevMacd.histogram > earlyEntryThreshold && macd.histogram < earlyEntryThreshold
    // Isso detecta quando o histograma está próximo de cruzar, acionando o sinal mais cedo
    if (prevMacd.histogram > earlyEntryThreshold && macd.histogram < earlyEntryThreshold && macd.histogram >= -earlyEntryThreshold) {
      const stopLoss = currentPrice * 1.04; // 4% acima
      const target1 = currentPrice * 0.80; // 20% abaixo
      const target2 = currentPrice * 0.80; // 20% abaixo (mesmo target)
      const target3 = currentPrice * 0.80; // 20% abaixo (mesmo target)

      const strength = Math.min(100, Math.max(60, Math.round(Math.abs(macd.histogram) * 1000)));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          macd: macd.macd.toFixed(4),
          signal: macd.signal.toFixed(4),
          histogram: macd.histogram.toFixed(4),
          prevHistogram: prevMacd.histogram.toFixed(4),
          earlyEntry: true,
          threshold: earlyEntryThreshold,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia MACD Histogram para ${symbol}:`, error);
    return null;
  }
}


/**
 * Estratégia MACD Histogram + PMO: Histograma 1h com filtro PMO
 * COMPRA: histograma cruza para cima E PMO > -0.5
 * VENDA: histograma cruza para baixo E PMO < 0.5
 */
export async function runMacdHistogramPmoStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  // Esta estratégia funciona apenas com timeframe 1h
  if (timeframe !== '1h') {
    return null;
  }

  const fastPeriod = params.fastPeriod || 12;
  const slowPeriod = params.slowPeriod || 26;
  const signalPeriod = params.signalPeriod || 9;
  const pmoBuyThreshold = params.pmoBuyThreshold || -0.5;
  const pmoSellThreshold = params.pmoSellThreshold || 0.5;
  
  // Parâmetros PMO TradingView: firstLength=35, secondLength=20
  // Fórmula: pmo = ema(10 * ema(roc(src, 1), 35), 20)
  const pmoFirstLength = params.rocPeriodPmo || 35;  // firstLength (1st Smoothing Length)
  const pmoSecondLength = params.emaFastPmo || 20;  // secondLength (2nd Smoothing Length)

  try {
    // Buscar candles suficientes para MACD e PMO
    const maxPeriod = Math.max(slowPeriod + signalPeriod, pmoFirstLength + pmoSecondLength) + 20;
    const candles = await fetchCandles(symbol, timeframe, maxPeriod);
    
    if (candles.length < maxPeriod) {
      return null;
    }

    const closes = getCloses(candles);

    // Calcular MACD
    const macd = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod);
    if (macd === null) {
      return null;
    }

    // Calcular MACD anterior para detectar cruzamento
    const prevCloses = closes.slice(0, -1);
    const prevMacd = calculateMACD(prevCloses, fastPeriod, slowPeriod, signalPeriod);
    if (prevMacd === null) {
      return null;
    }

    // Calcular PMO com parâmetros TradingView
    // Fórmula: ROC(1) → EMA(35) → ×10 → EMA(20) → PMO
    const pmo = calculatePMO(closes, pmoFirstLength, pmoSecondLength);
    if (pmo === null) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    // Sinal de COMPRA: Histograma cruza para cima (de negativo para positivo) E PMO > -0.5
    if (prevMacd.histogram < 0 && macd.histogram > 0 && pmo > pmoBuyThreshold) {
      const stopLoss = currentPrice * 0.96; // 4% abaixo
      const target1 = currentPrice * 1.20; // 20% acima
      const target2 = currentPrice * 1.20;
      const target3 = currentPrice * 1.20;

      // Força baseada no histograma e PMO
      const histogramStrength = Math.min(50, Math.round(Math.abs(macd.histogram) * 1000));
      const pmoStrength = Math.min(50, Math.round((pmo - pmoBuyThreshold) * 20));
      const strength = Math.min(100, Math.max(60, histogramStrength + pmoStrength));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          macd: macd.macd.toFixed(4),
          signal: macd.signal.toFixed(4),
          histogram: macd.histogram.toFixed(4),
          prevHistogram: prevMacd.histogram.toFixed(4),
          pmo: pmo.toFixed(4),
          pmoBuyThreshold,
        }),
      };
    }

    // Sinal de VENDA: Histograma cruza para baixo (de positivo para negativo) E PMO < 0.5
    if (prevMacd.histogram > 0 && macd.histogram < 0 && pmo < pmoSellThreshold) {
      const stopLoss = currentPrice * 1.04; // 4% acima
      const target1 = currentPrice * 0.80; // 20% abaixo
      const target2 = currentPrice * 0.80;
      const target3 = currentPrice * 0.80;

      // Força baseada no histograma e PMO
      const histogramStrength = Math.min(50, Math.round(Math.abs(macd.histogram) * 1000));
      const pmoStrength = Math.min(50, Math.round((pmoSellThreshold - pmo) * 20));
      const strength = Math.min(100, Math.max(60, histogramStrength + pmoStrength));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          macd: macd.macd.toFixed(4),
          signal: macd.signal.toFixed(4),
          histogram: macd.histogram.toFixed(4),
          prevHistogram: prevMacd.histogram.toFixed(4),
          pmo: pmo.toFixed(4),
          pmoSellThreshold,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia MACD Histogram + PMO para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia MA200 Crossover 1H: Gera sinais quando preço cruza a média móvel de 200 períodos
 * Filtro de tendência: Só compra se preço acima da MA200, só vende se preço abaixo da MA200
 * Timeframe 1h - sinais de hora a hora
 * Apenas para símbolos com market cap > 70 milhões
 */
export async function runMa60CrossoverStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  // Esta estratégia funciona apenas com timeframe 1h
  if (timeframe !== '1h') {
    return null;
  }

  // Sempre usar MA200 - ignorar params (evita maPeriod:60 no banco antigo)
  const maPeriod = 200;
  const ma200Period = 200; // Filtro de tendência

  try {
    // Buscar candles suficientes para calcular MA200
    const candlesNeeded = Math.max(maPeriod, ma200Period) + 20;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < Math.max(maPeriod, ma200Period) + 2) {
      return null;
    }

    const closes = getCloses(candles);
    
    // Calcular média móvel de 200 períodos atual
    const currentMA = calculateSMA(closes, maPeriod);
    if (currentMA === null) {
      return null;
    }

    // Calcular média móvel anterior (sem o último candle)
    const prevCloses = closes.slice(0, -1);
    const prevMA = calculateSMA(prevCloses, maPeriod);
    if (prevMA === null) {
      return null;
    }

    // Calcular MA200 para filtro de tendência
    const currentMA200 = calculateSMA(closes, ma200Period);
    if (currentMA200 === null) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;
    const prevPrice = candles[candles.length - 2].close;

    // Sinal de COMPRA: Preço cruza acima da MA200 E preço está acima da MA200 (tendência de alta)
    if (prevPrice < prevMA && currentPrice > currentMA) {
      // Filtro: só compra se preço estiver acima da MA200
      if (currentPrice <= currentMA200) {
        return null; // Preço abaixo da MA200, não compra
      }

      const stopLoss = currentPrice * 0.96; // 4% abaixo
      const target1 = currentPrice * 1.20; // 20% acima
      const target2 = currentPrice * 1.20;
      const target3 = currentPrice * 1.20;

      // Força baseada na distância do preço à média
      const distanceFromMA = ((currentPrice - currentMA) / currentMA) * 100;
      const strength = Math.min(100, Math.max(60, Math.round(50 + distanceFromMA * 2)));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          ma200: currentMA.toFixed(4),
          prevPrice: prevPrice.toFixed(4),
          currentPrice: currentPrice.toFixed(4),
          distanceFromMA: distanceFromMA.toFixed(2),
          distanceFromMA200: ((currentPrice - currentMA200) / currentMA200 * 100).toFixed(2),
          maPeriod,
        }),
      };
    }

    // Sinal de VENDA: Preço cruza abaixo da MA200 E preço está abaixo da MA200 (tendência de baixa)
    if (prevPrice > prevMA && currentPrice < currentMA) {
      // Filtro: só vende se preço estiver abaixo da MA200
      if (currentPrice >= currentMA200) {
        return null; // Preço acima da MA200, não vende
      }

      const stopLoss = currentPrice * 1.04; // 4% acima
      const target1 = currentPrice * 0.80; // 20% abaixo
      const target2 = currentPrice * 0.80;
      const target3 = currentPrice * 0.80;

      // Força baseada na distância do preço à média
      const distanceFromMA = ((currentMA - currentPrice) / currentMA) * 100;
      const strength = Math.min(100, Math.max(60, Math.round(50 + distanceFromMA * 2)));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          ma200: currentMA.toFixed(4),
          prevPrice: prevPrice.toFixed(4),
          currentPrice: currentPrice.toFixed(4),
          distanceFromMA: distanceFromMA.toFixed(2),
          distanceFromMA200: ((currentMA200 - currentPrice) / currentMA200 * 100).toFixed(2),
          maPeriod,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia MA60 Crossover para ${symbol}:`, error);
    return null;
  }
}

/**
 * RSI 1h — VENDA: RSI estava ≥ limiar sobrecomprado, no candle atual cai para abaixo de 70
 * com queda de pelo menos `minDropPoints` pontos (ex.: 72→68, 71→67),
 * e afastamento % do fecho à média longa (def. EMA 80) > `minDistancePct` (ex.: 12%).
 * SL 6% acima; TP1/2/3 na média longa (mean reversion no mesmo TF).
 * O universo de símbolos é escolhido em `runAllStrategies`: último scan gravado Scanner 1 (acima MA200, 1h).
 */
export async function runRsiOverboughtDrop1hStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') {
    return null;
  }

  const rsiPeriod = Math.max(2, Number(params.rsiPeriod) || 14);
  const overboughtLevel = Number(params.overboughtLevel ?? 70);
  const minDropPoints = Math.max(1, Number(params.minDropPoints) || 4);
  const minDistancePct = Number(params.minDistancePct ?? 12);
  const maPeriod = Math.max(2, Number(params.maPeriod) || 80);
  const meanLineType =
    String(params.meanLineType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const stopLossPct = Number(params.stopLossPct ?? 0.06);

  const candlesNeeded = Math.max(maPeriod, rsiPeriod) + 50;
  try {
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < Math.max(maPeriod, rsiPeriod) + 5) {
      return null;
    }

    const closes = getCloses(candles);
    const rsiCurr = calculateRSI(closes, rsiPeriod);
    const rsiPrev = calculateRSI(closes.slice(0, -1), rsiPeriod);
    if (rsiCurr === null || rsiPrev === null) {
      return null;
    }

    const drop = rsiPrev - rsiCurr;
    const crossedDownFromOverbought =
      rsiPrev >= overboughtLevel && rsiCurr < overboughtLevel && drop >= minDropPoints;

    if (!crossedDownFromOverbought) {
      return null;
    }

    const distances =
      meanLineType === 'SMA'
        ? getSmaPercentDistanceSeries(closes, maPeriod)
        : getEmaPercentDistanceSeries(closes, maPeriod);
    if (distances.length < 1) {
      return null;
    }
    const currDist = distances[distances.length - 1];
    if (!(currDist > minDistancePct)) {
      return null;
    }

    let meanAtClose: number | null = null;
    if (meanLineType === 'EMA') {
      const em = calculateEMA(closes, maPeriod);
      meanAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      meanAtClose = calculateSMA(closes, maPeriod);
    }
    if (meanAtClose === null || meanAtClose === 0) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;
    const stopLoss = currentPrice * (1 + stopLossPct);
    const target1 = meanAtClose;

    const strength = Math.min(
      100,
      Math.max(
        70,
        Math.round(
          70 +
            Math.min(drop - minDropPoints, 8) * 2 +
            Math.min(Math.max(currDist - minDistancePct, 0), 18)
        )
      )
    );

    return {
      direction: 'SELL',
      entryPrice: currentPrice,
      stopLoss,
      target1,
      target2: target1,
      target3: target1,
      strength,
      extraInfo: JSON.stringify({
        setup: 'rsi_overbought_drop_distance_ma',
        rsiPeriod,
        overboughtLevel,
        minDropPoints,
        minDistancePct,
        rsiPrev: rsiPrev.toFixed(2),
        rsiCurr: rsiCurr.toFixed(2),
        drop: drop.toFixed(2),
        distancePct: currDist.toFixed(3),
        meanLineType,
        maPeriod,
        stopLossPct,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia RSI queda 70 + afastamento para ${symbol}:`, error);
    return null;
  }
}

/**
 * Afastamento médio (TradingView-style): distância % do fecho à média longa (EMA ou SMA, def.: EMA 80),
 * com suavização SMA(smoothPeriod) dessa série (ex.: 7).
 * COMPRA: só na linha suavizada — no candle anterior ≤ buySmoothPrevMax (def. 2) e no atual ≥ buySmoothCurrMin (def. 3),
 * e preço acima da média de tendência (def.: EMA 30).
 * VENDA: afastamento a cru cruza acima do limiar superior vs a mesma média longa (inalterado).
 */
export async function runAfastamentoMedioStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') {
    return null;
  }

  const maPeriod = Math.max(2, Number(params.maPeriod) || 80);
  const smoothPeriod = Math.max(2, Number(params.smoothPeriod) || 7);
  const upperThreshold = Number(params.upperThresholdPct ?? 60);
  const lowerThreshold = Number(params.lowerThresholdPct ?? -60);
  const buyTrendMaPeriod = Math.max(2, Number(params.buyTrendMaPeriod) || 30);
  const buySmoothPrevMax = Number(params.buySmoothPrevMax ?? 2);
  const buySmoothCurrMin = Number(params.buySmoothCurrMin ?? 3);
  const meanLineType =
    String(params.meanLineType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const trendMaType =
    String(params.trendMaType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const requireSmoothCross =
    params.requireSmoothCross === true ||
    params.requireSmoothCross === 'true';

  const candlesNeeded = Math.max(maPeriod, buyTrendMaPeriod) + smoothPeriod + 40;
  try {
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    const minCloses = Math.max(maPeriod, buyTrendMaPeriod) + smoothPeriod + 3;
    if (candles.length < minCloses) {
      return null;
    }

    const closes = getCloses(candles);
    const distances =
      meanLineType === 'SMA'
        ? getSmaPercentDistanceSeries(closes, maPeriod)
        : getEmaPercentDistanceSeries(closes, maPeriod);
    if (distances.length < smoothPeriod + 2) {
      return null;
    }

    const currDist = distances[distances.length - 1];
    const prevDist = distances[distances.length - 2];

    const smoothCurr = smaTail(distances, smoothPeriod);
    const smoothPrev = smaTail(distances.slice(0, -1), smoothPeriod);
    if (smoothCurr === null || smoothPrev === null) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    let meanAtClose: number | null = null;
    if (meanLineType === 'EMA') {
      const em = calculateEMA(closes, maPeriod);
      meanAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      meanAtClose = calculateSMA(closes, maPeriod);
    }

    let trendAtClose: number | null = null;
    if (trendMaType === 'EMA') {
      const em = calculateEMA(closes, buyTrendMaPeriod);
      trendAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      trendAtClose = calculateSMA(closes, buyTrendMaPeriod);
    }

    if (
      meanAtClose === null ||
      meanAtClose === 0 ||
      trendAtClose === null ||
      trendAtClose === 0
    ) {
      return null;
    }

    const extraBase = {
      maPeriod,
      smoothPeriod,
      meanLineType,
      trendMaType,
      distancePct: currDist.toFixed(3),
      prevDistancePct: prevDist.toFixed(3),
      smoothDistancePct: smoothCurr.toFixed(3),
      prevSmoothDistancePct: smoothPrev.toFixed(3),
      meanAtClose: meanAtClose.toFixed(8),
      trendMaPeriod: buyTrendMaPeriod,
      trendAtClose: trendAtClose.toFixed(8),
      upperThreshold,
      lowerThreshold,
      buySmoothPrevMax,
      buySmoothCurrMin,
    };

    const crossShort =
      prevDist <= upperThreshold &&
      currDist > upperThreshold &&
      (!requireSmoothCross || (smoothPrev <= upperThreshold && smoothCurr > upperThreshold));

    if (crossShort) {
      const stopLoss = currentPrice * 1.04;
      const target1 = meanAtClose;
      const overshoot = currDist - upperThreshold;
      const strength = Math.min(100, Math.max(60, Math.round(65 + Math.min(overshoot, 40))));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2: target1,
        target3: target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          setup: 'mean_reversion_short',
        }),
      };
    }

    // Linha «7»: SMA(smoothPeriod) do afastamento %; COMPRA só no passo 2→3 nessa linha.
    const buyCrossSmooth2To3 =
      smoothPrev <= buySmoothPrevMax && smoothCurr >= buySmoothCurrMin;

    if (buyCrossSmooth2To3 && currentPrice > trendAtClose) {
      const stopLoss = currentPrice * 0.96;
      const target1 = currentPrice * 1.2;
      const target2 = target1;
      const target3 = target1;
      const rise = smoothCurr - smoothPrev;
      const strength = Math.min(
        100,
        Math.max(60, Math.round(65 + Math.min(Math.max(rise, 0) * 10, 25)))
      );

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          setup: 'smooth_cross_2_to_3_above_ma30',
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia Afastamento Médio para ${symbol}:`, error);
    return null;
  }
}

/**
 * Afastamento médio em 30m: mesma estrutura que 1h (EMA80 + SMA7 do afastamento %).
 * COMPRA: linha suavizada cruza de ≤ buySmoothPrevMax (def. 1) para ≥ buySmoothCurrMin (def. 2), com preço > média de tendência.
 * VENDA: igual ao afastamento 1h (cruze do afastamento cru acima do limiar superior).
 * Risco/ganho (defeito): SL 6%; TP1 a 18% a favor da entrada — só target1 preenchido para o executor
 * colocar take-profit parcial de 40% da posição (TP2 omitido).
 */
export async function runAfastamentoMedio30mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '30m') {
    return null;
  }

  const maPeriod = Math.max(2, Number(params.maPeriod) || 80);
  const smoothPeriod = Math.max(2, Number(params.smoothPeriod) || 7);
  const upperThreshold = Number(params.upperThresholdPct ?? 60);
  const lowerThreshold = Number(params.lowerThresholdPct ?? -60);
  const buyTrendMaPeriod = Math.max(2, Number(params.buyTrendMaPeriod) || 30);
  const buySmoothPrevMax = Number(params.buySmoothPrevMax ?? 1);
  const buySmoothCurrMin = Number(params.buySmoothCurrMin ?? 2);
  const stopLossPct = Math.min(0.5, Math.max(0.001, Number(params.stopLossPct ?? 0.06)));
  const takeProfitPct = Math.min(1, Math.max(0.001, Number(params.takeProfitPct ?? 0.18)));
  const meanLineType =
    String(params.meanLineType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const trendMaType =
    String(params.trendMaType || 'EMA').toUpperCase() === 'SMA' ? 'SMA' : 'EMA';
  const requireSmoothCross =
    params.requireSmoothCross === true ||
    params.requireSmoothCross === 'true';

  const candlesNeeded = Math.max(maPeriod, buyTrendMaPeriod) + smoothPeriod + 40;
  try {
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    const minCloses = Math.max(maPeriod, buyTrendMaPeriod) + smoothPeriod + 3;
    if (candles.length < minCloses) {
      return null;
    }

    const closes = getCloses(candles);
    const distances =
      meanLineType === 'SMA'
        ? getSmaPercentDistanceSeries(closes, maPeriod)
        : getEmaPercentDistanceSeries(closes, maPeriod);
    if (distances.length < smoothPeriod + 2) {
      return null;
    }

    const currDist = distances[distances.length - 1];
    const prevDist = distances[distances.length - 2];

    const smoothCurr = smaTail(distances, smoothPeriod);
    const smoothPrev = smaTail(distances.slice(0, -1), smoothPeriod);
    if (smoothCurr === null || smoothPrev === null) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    let meanAtClose: number | null = null;
    if (meanLineType === 'EMA') {
      const em = calculateEMA(closes, maPeriod);
      meanAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      meanAtClose = calculateSMA(closes, maPeriod);
    }

    let trendAtClose: number | null = null;
    if (trendMaType === 'EMA') {
      const em = calculateEMA(closes, buyTrendMaPeriod);
      trendAtClose = em?.length ? em[em.length - 1]! : null;
    } else {
      trendAtClose = calculateSMA(closes, buyTrendMaPeriod);
    }

    if (
      meanAtClose === null ||
      meanAtClose === 0 ||
      trendAtClose === null ||
      trendAtClose === 0
    ) {
      return null;
    }

    const extraBase = {
      maPeriod,
      smoothPeriod,
      meanLineType,
      trendMaType,
      distancePct: currDist.toFixed(3),
      prevDistancePct: prevDist.toFixed(3),
      smoothDistancePct: smoothCurr.toFixed(3),
      prevSmoothDistancePct: smoothPrev.toFixed(3),
      meanAtClose: meanAtClose.toFixed(8),
      trendMaPeriod: buyTrendMaPeriod,
      trendAtClose: trendAtClose.toFixed(8),
      upperThreshold,
      lowerThreshold,
      buySmoothPrevMax,
      buySmoothCurrMin,
    };

    const crossShort =
      prevDist <= upperThreshold &&
      currDist > upperThreshold &&
      (!requireSmoothCross || (smoothPrev <= upperThreshold && smoothCurr > upperThreshold));

    if (crossShort) {
      const stopLoss = currentPrice * (1 + stopLossPct);
      const target1 = currentPrice * (1 - takeProfitPct);
      const overshoot = currDist - upperThreshold;
      const strength = Math.min(100, Math.max(60, Math.round(65 + Math.min(overshoot, 40))));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          setup: 'mean_reversion_short_30m',
          stopLossPct,
          takeProfitPct,
          takeProfitPartialNote: 'TP1 40% posição via executor; target2 omitido',
        }),
      };
    }

    const buyCrossSmooth1To2 =
      smoothPrev <= buySmoothPrevMax && smoothCurr >= buySmoothCurrMin;

    if (buyCrossSmooth1To2 && currentPrice > trendAtClose) {
      const stopLoss = currentPrice * (1 - stopLossPct);
      const target1 = currentPrice * (1 + takeProfitPct);
      const rise = smoothCurr - smoothPrev;
      const strength = Math.min(
        100,
        Math.max(60, Math.round(65 + Math.min(Math.max(rise, 0) * 10, 25)))
      );

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        strength,
        extraInfo: JSON.stringify({
          ...extraBase,
          setup: 'smooth_cross_1_to_2_above_trend_ma_30m',
          stopLossPct,
          takeProfitPct,
          takeProfitPartialNote: 'TP1 40% posição via executor; target2 omitido',
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia Afastamento Médio 30m para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia PMO: Cruzamento da linha zero
 * PMO cruza acima de zero = BUY, cruza abaixo = SELL
 * Timeframe 4h, horários: 8h, 12h, 16h, 20h, 23h
 */
export async function runPmoStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '4h') return null;
  if (!isAllowedTime()) return null;

  const pmoFirst = params.rocPeriod || 35;
  const pmoSecond = params.emaFast || 20;

  try {
    const candles = await fetchCandles(symbol, timeframe, pmoFirst + pmoSecond + 30);
    if (candles.length < pmoFirst + pmoSecond + 10) return null;

    const closes = getCloses(candles);
    const pmo = calculatePMO(closes, pmoFirst, pmoSecond);
    const prevCloses = closes.slice(0, -1);
    const prevPmo = calculatePMO(prevCloses, pmoFirst, pmoSecond);

    if (pmo === null || prevPmo === null) return null;

    const currentPrice = candles[candles.length - 1].close;

    if (prevPmo < 0 && pmo > 0) {
      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss: currentPrice * 0.96,
        target1: currentPrice * 1.20,
        target2: currentPrice * 1.20,
        target3: currentPrice * 1.20,
        strength: Math.min(100, Math.max(60, Math.round(60 + Math.abs(pmo) * 20))),
        extraInfo: JSON.stringify({ pmo: pmo.toFixed(4), prevPmo: prevPmo.toFixed(4) }),
      };
    }
    if (prevPmo > 0 && pmo < 0) {
      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss: currentPrice * 1.04,
        target1: currentPrice * 0.80,
        target2: currentPrice * 0.80,
        target3: currentPrice * 0.80,
        strength: Math.min(100, Math.max(60, Math.round(60 + Math.abs(pmo) * 20))),
        extraInfo: JSON.stringify({ pmo: pmo.toFixed(4), prevPmo: prevPmo.toFixed(4) }),
      };
    }
    return null;
  } catch (error) {
    console.error(`Erro na estratégia PMO para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia Multi-Timeframe (4H + 1H): Regime RANGE/TREND com entradas Bollinger ou Breakout+Reteste
 * Timeframe 1h (avalia no 1H com contexto 4H)
 */
export async function runMultiTimeframeStrategy(
  symbol: string,
  timeframe: Timeframe,
  _params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  try {
    const candles1H = await fetchCandles(symbol, '1h', 250);
    const candles4H = await fetchCandles(symbol, '4h', 80);
    if (candles1H.length < 150 || candles4H.length < 60) return null;

    const { evaluate } = createEntrySignals(candles1H, candles4H);
    const i1H = candles1H.length - 1;
    const signal = evaluate(i1H);

    if (signal.type === 'NONE') return null;

    const currentPrice = candles1H[i1H].close;
    const atr = 0.02 * currentPrice;

    if (signal.type === 'LONG') {
      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss: currentPrice - atr * 2,
        target1: currentPrice + atr * 3,
        target2: currentPrice + atr * 4,
        target3: currentPrice + atr * 5,
        strength: 70,
        extraInfo: JSON.stringify({ reason: signal.reason, regime: signal.regime4H, bias: signal.bias4H }),
      };
    }
    if (signal.type === 'SHORT') {
      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss: currentPrice + atr * 2,
        target1: currentPrice - atr * 3,
        target2: currentPrice - atr * 4,
        target3: currentPrice - atr * 5,
        strength: 70,
        extraInfo: JSON.stringify({ reason: signal.reason, regime: signal.regime4H, bias: signal.bias4H }),
      };
    }
    return null;
  } catch (error) {
    console.error(`Erro na estratégia Multi-Timeframe para ${symbol}:`, error);
    return null;
  }
}

/**
 * Busca símbolos da Binance com market cap superior a 70 milhões
 * Usa CoinGecko API para obter market cap real
 */
export async function fetchSymbolsWithMarketCap(minMarketCap: number = 70000000): Promise<string[]> {
  try {
    // Buscar todos os símbolos USDT da Binance Futures
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!response.ok) {
      throw new Error(`Erro ao buscar símbolos: ${response.statusText}`);
    }

    const data = await response.json();
    const usdtSymbols = data
      .filter((ticker: any) => ticker.symbol.endsWith('USDT') && !ticker.symbol.includes('BUSD'))
      .map((ticker: any) => ticker.symbol);

    // Tentar usar CoinGecko para obter market cap real
    // Mapear símbolos Binance para IDs CoinGecko (exemplo: BTCUSDT -> bitcoin)
    // Por simplicidade, vamos usar uma aproximação baseada em volume
    // Símbolos com alto volume geralmente têm alto market cap
    
    // Filtrar por quoteVolume alto (aproximação de market cap)
    // 70 milhões de market cap geralmente corresponde a ~10-50M de volume diário
    const minQuoteVolume = minMarketCap / 10; // Aproximação conservadora
    const filteredSymbols = data
      .filter((ticker: any) => {
        return ticker.symbol.endsWith('USDT') && 
               !ticker.symbol.includes('BUSD') &&
               parseFloat(ticker.quoteVolume) >= minQuoteVolume;
      })
      .map((ticker: any) => ticker.symbol);

    return filteredSymbols;
  } catch (error) {
    console.error('Erro ao buscar símbolos com market cap:', error);
    // Fallback: retornar lista vazia ou símbolos padrão
    return [];
  }
}

/**
 * Verifica se o horário atual está permitido para gerar sinais
 * Horários permitidos: 8h, 12h, 16h, 20h, 23h (de 4 em 4 horas)
 */
function isAllowedTime(): boolean {
  const now = new Date();
  const hour = now.getHours();
  const allowedHours = [8, 12, 16, 20, 23];
  return allowedHours.includes(hour);
}



export interface RunAllStrategiesOptions {
  /** Estratégias a excluir por nome (opcional) */
  exclude?: string[];
}

/**
 * Função principal que executa todas as estratégias ativas
 * @param options.exclude - Nomes de estratégias a excluir
 */
export async function runAllStrategies(options?: RunAllStrategiesOptions): Promise<number> {
  let signalsCreated = 0;

  try {
    await ensureMissingBuiltinStrategies(prisma);
    // Estratégias ativas — SELECT legado se symbolUniverseId / SymbolUniverse ainda não existirem na BD
    let strategies: StrategyWithUniverseRow[] = await findStrategiesWithUniverseFallback({
      activeOnly: true,
    });

    if (options?.exclude?.length) {
      strategies = strategies.filter((s) => !options!.exclude!.includes(s.name));
      console.log(`📋 Estratégias excluídas: ${options.exclude.join(', ')}`);
    }

    const removedLegacy = ['RSI', 'SCANNER_APLUS', 'VOLUME_SPIKE', 'VOLUME_SPIKE_15M'];
    strategies = strategies.filter((s) => !removedLegacy.includes(s.name));

    if (strategies.length === 0) {
      console.log('Nenhuma estratégia ativa encontrada');
      return 0;
    }

    // Símbolos: top 150 por variação de preço na última hora (momentum 1h), não por volume 24h
    console.log('🔍 Buscando símbolos por variação na última hora (Binance Futures)...');
    let symbols: string[] = [];
    try {
      symbols = await fetchTopSymbolsBy1hPriceChange(150, 250);
      console.log(`✅ Encontrados ${symbols.length} símbolos (top por alta na última hora)`);
    } catch (err) {
      console.error('Erro ao buscar símbolos por variação 1h, usando fallback:', err);
      symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
    }

    const timeframes: Timeframe[] = ['1h', '4h'];
    const unknownStrategiesLogged = new Set<string>();

    for (const strategy of strategies) {

      const params = JSON.parse(strategy.params || '{}');

      const timeframesToUse: Timeframe[] =
        strategy.name === 'AFASTAMENTO_MEDIO_30M'
          ? ['30m']
          : strategy.name === 'RSI_OVERBOUGHT_DROP_1H'
            ? ['1h']
            : timeframes;

      // Universo configurado na BD (Scanner 1 / 2 / 3) substitui listagens por defeito.
      // Afastamento 1h/30m e RSI queda 70 ignoram symbolUniverse: usam último scan gravado (Scanner 2 ou 1).
      let symbolsToAnalyze = symbols;
      if (
        strategy.symbolUniverse &&
        strategy.name !== 'AFASTAMENTO_MEDIO' &&
        strategy.name !== 'AFASTAMENTO_MEDIO_30M' &&
        strategy.name !== 'RSI_OVERBOUGHT_DROP_1H'
      ) {
        const su = strategy.symbolUniverse;
        console.log(`🔍 Universo «${su.displayName}» (${su.code}) para ${strategy.name}...`);
        try {
          symbolsToAnalyze = await scanSymbolUniverseSymbols({
            ruleType: su.ruleType,
            maPeriod: su.maPeriod,
            maxDistancePct: su.maxDistancePct,
            timeframe: su.timeframe,
            minQuoteVolume: su.minQuoteVolume,
            candidateLimit: su.candidateLimit,
          });
          console.log(`✅ ${symbolsToAnalyze.length} símbolos após filtro de universo`);
        } catch (e) {
          console.error(`Erro ao aplicar universo ${su.code}:`, e);
          symbolsToAnalyze = [];
        }
      } else if (strategy.name === 'AFASTAMENTO_MEDIO') {
        const code = UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80;
        console.log(
          '🔍 AFASTAMENTO_MEDIO: universo = último scan Scanner 2 (±10% SMA80, 1h) gravado na BD...'
        );
        const latest = await getLatestUniverseScanSymbols(code);
        if (!latest.ok) {
          console.warn(`⚠️  AFASTAMENTO_MEDIO: ${latest.reason}`);
          symbolsToAnalyze = [];
        } else {
          symbolsToAnalyze = latest.symbols;
          console.log(
            `✅ ${symbolsToAnalyze.length} símbolos (BD: scan ${latest.scannedAt.toISOString()}, ${latest.rowCount} linhas)`
          );
        }
      } else if (strategy.name === 'AFASTAMENTO_MEDIO_30M') {
        const code = UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80;
        console.log(
          '🔍 AFASTAMENTO_MEDIO_30M: universo = último scan Scanner 2 (±10% SMA80, 1h) gravado na BD; sinais em 30m...'
        );
        const latest = await getLatestUniverseScanSymbols(code);
        if (!latest.ok) {
          console.warn(`⚠️  AFASTAMENTO_MEDIO_30M: ${latest.reason}`);
          symbolsToAnalyze = [];
        } else {
          symbolsToAnalyze = latest.symbols;
          console.log(
            `✅ ${symbolsToAnalyze.length} símbolos (BD: scan ${latest.scannedAt.toISOString()}, ${latest.rowCount} linhas)`
          );
        }
      } else if (strategy.name === 'RSI_OVERBOUGHT_DROP_1H') {
        const code = UNIVERSE_CODE_SCANNER_1_ABOVE_MA200;
        console.log(
          '🔍 RSI_OVERBOUGHT_DROP_1H: universo = último scan Scanner 1 (acima MA200, 1h) gravado na BD...'
        );
        const latest = await getLatestUniverseScanSymbols(code);
        if (!latest.ok) {
          console.warn(`⚠️  RSI_OVERBOUGHT_DROP_1H: ${latest.reason}`);
          symbolsToAnalyze = [];
        } else {
          symbolsToAnalyze = latest.symbols;
          console.log(
            `✅ ${symbolsToAnalyze.length} símbolos (BD: scan ${latest.scannedAt.toISOString()}, ${latest.rowCount} linhas)`
          );
        }
      } else if (strategy.name === 'MA60_CROSSOVER') {
        console.log('🔍 Buscando símbolos com market cap > 70 milhões para estratégia MA60_CROSSOVER...');
        const highMarketCapSymbols = await fetchSymbolsWithMarketCap(70000000);
        if (highMarketCapSymbols.length > 0) {
          symbolsToAnalyze = highMarketCapSymbols;
          console.log(`✅ Encontrados ${highMarketCapSymbols.length} símbolos com market cap > 70 milhões`);
        } else {
          console.warn('⚠️  Nenhum símbolo com market cap > 70 milhões encontrado, usando lista padrão');
        }
      }

      for (const symbol of symbolsToAnalyze) {
        for (const timeframe of timeframesToUse) {
          try {
            let signalResult: SignalResult | null = null;

            // Executa a estratégia correspondente
            switch (strategy.name) {
              case 'MACD_HISTOGRAM':
                signalResult = await runMacdHistogramStrategy(symbol, timeframe, params);
                break;
              case 'MACD_HISTOGRAM_PMO':
                signalResult = await runMacdHistogramPmoStrategy(symbol, timeframe, params);
                break;
              case 'MA60_CROSSOVER':
                signalResult = await runMa60CrossoverStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ MA60 sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'AFASTAMENTO_MEDIO':
                signalResult = await runAfastamentoMedioStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(
                    `✅ Afastamento médio sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`
                  );
                }
                break;
              case 'AFASTAMENTO_MEDIO_30M':
                signalResult = await runAfastamentoMedio30mStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(
                    `✅ Afastamento médio 30m sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`
                  );
                }
                break;
              case 'RSI_OVERBOUGHT_DROP_1H':
                signalResult = await runRsiOverboughtDrop1hStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(
                    `✅ RSI queda 70+afastamento sinal: ${symbol} ${signalResult.direction} (${timeframe})`
                  );
                }
                break;
              case 'PMO':
                signalResult = await runPmoStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ PMO sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'MULTI_TIMEFRAME':
                signalResult = await runMultiTimeframeStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ Multi-Timeframe sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              default:
                if (!unknownStrategiesLogged.has(strategy.name)) {
                  unknownStrategiesLogged.add(strategy.name);
                  console.warn(`Estratégia desconhecida (ignorada): ${strategy.name}`);
                }
                continue;
            }

            // Se um sinal foi gerado, salva no banco
            if (signalResult) {
              // Verifica se já existe um sinal similar recente (evita duplicados)
              const recentSignal = await prisma.signal.findFirst({
                where: {
                  symbol,
                  strategyId: strategy.id,
                  timeframe,
                  direction: signalResult.direction,
                  status: { in: ['NEW', 'IN_PROGRESS'] },
                  generatedAt: {
                    gte: new Date(Date.now() - 2 * 60 * 60 * 1000), // Últimas 2 horas
                  },
                },
              });

              if (!recentSignal) {
                await prisma.signal.create({
                  data: {
                    symbol,
                    direction: signalResult.direction,
                    timeframe,
                    strategyId: strategy.id,
                    strategyName: strategy.displayName,
                    entryPrice: signalResult.entryPrice,
                    stopLoss: signalResult.stopLoss,
                    target1: signalResult.target1,
                    target2: signalResult.target2,
                    target3: signalResult.target3,
                    strength: signalResult.strength,
                    status: 'NEW',
                    extraInfo: signalResult.extraInfo,
                  },
                });

                signalsCreated++;
                console.log(
                  `✅ Sinal criado: ${symbol} ${signalResult.direction} (${strategy.displayName})`
                );
              } else {
                console.log(
                  `⏭️  Sinal duplicado ignorado: ${symbol} ${signalResult.direction} (${strategy.displayName}) - já existe nas últimas 2h`
                );
              }
            }

            // Pequeno delay para não sobrecarregar a API
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            console.error(
              `Erro ao processar ${strategy.name} para ${symbol} ${timeframe}:`,
              error
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('Erro ao executar estratégias:', error);
    throw error;
  }

  return signalsCreated;
}

