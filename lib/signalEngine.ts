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
import { fetchCandles, fetchTopSymbolsBy1hPriceChange, fetchTopSymbolsBy24hPriceChange, fetchTopSymbolsByVolume, type Timeframe } from './marketData';
import { createEntrySignals } from './multiTimeframeStrategy';
import { runScanner } from './scanner';
import {
  calculateSMA,
  calculateMACD,
  calculatePMO,
  calculateRSI,
  getCloses,
  getVolumes,
  calculateVolumeMA,
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
 * Estratégia Volume Spike: Gera sinais quando volume é maior que 12 vezes a média das últimas 20 horas
 * Timeframe 1h - analisa volume das últimas 20 horas
 */
export async function runVolumeSpikeStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  // Esta estratégia funciona apenas com timeframe 1h
  if (timeframe !== '1h') {
    return null;
  }

  // Mantemos mínimo 12x para reduzir ruído mesmo se params antigos tiverem 6x.
  const configuredMultiplier = Number(params.volumeMultiplier ?? 12);
  const volumeMultiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
    ? Math.max(12, configuredMultiplier)
    : 12;
  const lookbackHours = params.lookbackHours || 20; // Período para calcular média de volume

  try {
    // Buscar candles suficientes: 20 para média + 1 candle a avaliar (fechado) + margem
    // A API Binance devolve o último candle como o candle ATUAL (incompleto). O candle
    // fechado que queremos avaliar (ex.: 15h-16h) é o penúltimo (index -2).
    const candlesNeeded = lookbackHours + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    
    // Precisamos de pelo menos: 20 para média + 1 candle fechado a avaliar + 1 último (incompleto)
    if (candles.length < lookbackHours + 2) {
      return null;
    }

    const volumes = getVolumes(candles);
    // Usar o ÚLTIMO CANDLE FECHADO (penúltimo da lista), não o atual incompleto
    const lastClosedIndex = volumes.length - 2;
    const currentVolume = volumes[lastClosedIndex];
    
    // Média das 20 horas anteriores ao candle que estamos a avaliar (excluir o incompleto e o que avaliamos)
    const volumesForAverage = volumes.slice(-lookbackHours - 2, -2); // 20 volumes antes do candle fechado
    const volumeAverage = calculateVolumeMA(volumesForAverage, lookbackHours);
    
    if (volumeAverage === null || volumeAverage === 0) {
      return null;
    }

    // Verificar se volume do candle fechado é maior que 12 vezes a média
    const volumeRatio = currentVolume / volumeAverage;
    
    if (volumeRatio < volumeMultiplier) {
      return null; // Volume não é suficientemente alto
    }

    // Preço de fecho e anterior do candle que teve o spike (candle fechado)
    const currentPrice = candles[lastClosedIndex].close;
    const prevPrice = candles[lastClosedIndex - 1].close;
    
    // Determinar direção baseada no movimento de preço
    // Se preço subiu com volume alto = BUY, se caiu = SELL
    const priceChange = currentPrice - prevPrice;
    const direction: 'BUY' | 'SELL' = priceChange >= 0 ? 'BUY' : 'SELL';

    // Calcular stop loss e targets: TP1 9%, TP2 20%, 25% às 24h (preço de mercado)
    if (direction === 'BUY') {
      const stopLoss = currentPrice * 0.87; // 13% abaixo
      const target1 = currentPrice * 1.09; // 9% acima
      const target2 = currentPrice * 1.25; // 25% acima
      // TP3 = fechar às 24h ao preço que estiver (sem ordem na Binance)
      const target3: number | undefined = undefined;

      // Força baseada no múltiplo de volume (quanto maior, mais forte)
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackHours,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    } else {
      const stopLoss = currentPrice * 1.13; // 13% acima (SELL: stop acima da entrada)
      const target1 = currentPrice * 0.91; // 9% abaixo
      const target2 = currentPrice * 0.75; // 25% abaixo
      const target3: number | undefined = undefined; // TP3 = fechar às 24h ao preço que estiver

      // Força baseada no múltiplo de volume
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackHours,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    }
  } catch (error) {
    console.error(`Erro na estratégia Volume Spike para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia Volume Spike 15m: igual ao Volume Spike 1h mas em 15m com 15 períodos
 * Gera sinais quando volume do último candle 15m fechado é maior que 12x a média dos últimos 15 candles
 */
export async function runVolumeSpike15mStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '15m') {
    return null;
  }

  // Mantemos mínimo 12x para reduzir ruído mesmo se params antigos tiverem 6x.
  const configuredMultiplier = Number(params.volumeMultiplier ?? 12);
  const volumeMultiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
    ? Math.max(12, configuredMultiplier)
    : 12;
  const lookbackPeriods = params.lookbackPeriods ?? 15;

  try {
    const candlesNeeded = lookbackPeriods + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);

    if (candles.length < lookbackPeriods + 2) {
      return null;
    }

    const volumes = getVolumes(candles);
    const lastClosedIndex = volumes.length - 2;
    const currentVolume = volumes[lastClosedIndex];

    const volumesForAverage = volumes.slice(-lookbackPeriods - 2, -2);
    const volumeAverage = calculateVolumeMA(volumesForAverage, lookbackPeriods);

    if (volumeAverage === null || volumeAverage === 0) {
      return null;
    }

    const volumeRatio = currentVolume / volumeAverage;
    if (volumeRatio < volumeMultiplier) {
      return null;
    }

    const currentPrice = candles[lastClosedIndex].close;
    const prevPrice = candles[lastClosedIndex - 1].close;
    const priceChange = currentPrice - prevPrice;
    const direction: 'BUY' | 'SELL' = priceChange >= 0 ? 'BUY' : 'SELL';

    if (direction === 'BUY') {
      const stopLoss = currentPrice * 0.87;
      const target1 = currentPrice * 1.09;
      const target2 = currentPrice * 1.25;
      const target3: number | undefined = undefined;
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackPeriods,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    } else {
      const stopLoss = currentPrice * 1.13;
      const target1 = currentPrice * 0.91;
      const target2 = currentPrice * 0.75;
      const target3: number | undefined = undefined;
      const strength = Math.min(100, Math.max(60, Math.round(60 + (volumeRatio - volumeMultiplier) * 5)));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          currentVolume: currentVolume.toFixed(2),
          volumeAverage: volumeAverage.toFixed(2),
          volumeRatio: volumeRatio.toFixed(2),
          volumeMultiplier,
          lookbackPeriods,
          priceChange: priceChange.toFixed(4),
          priceChangePercent: ((priceChange / prevPrice) * 100).toFixed(2),
        }),
      };
    }
  } catch (error) {
    console.error(`Erro na estratégia Volume Spike 15m para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia RSI: Sobrecomprado (SELL) ou Sobrevendido (BUY)
 * RSI > overbought (70) = SELL, RSI < oversold (30) = BUY
 * Timeframe 1h
 */
export async function runRsiStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  if (timeframe !== '1h') return null;

  const period = params.period || 14;
  const overbought = params.overbought || 70;
  const oversold = params.oversold || 30;

  try {
    const candles = await fetchCandles(symbol, timeframe, period + 20);
    if (candles.length < period + 2) return null;

    const closes = getCloses(candles);
    const rsi = calculateRSI(closes, period);
    if (rsi === null) return null;

    const currentPrice = candles[candles.length - 1].close;

    if (rsi < oversold) {
      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss: currentPrice * 0.96,
        target1: currentPrice * 1.20,
        target2: currentPrice * 1.20,
        target3: currentPrice * 1.20,
        strength: Math.min(100, Math.max(60, Math.round(60 + (oversold - rsi) * 2))),
        extraInfo: JSON.stringify({ rsi: rsi.toFixed(2), oversold, period }),
      };
    }
    if (rsi > overbought) {
      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss: currentPrice * 1.04,
        target1: currentPrice * 0.80,
        target2: currentPrice * 0.80,
        target3: currentPrice * 0.80,
        strength: Math.min(100, Math.max(60, Math.round(60 + (rsi - overbought) * 2))),
        extraInfo: JSON.stringify({ rsi: rsi.toFixed(2), overbought, period }),
      };
    }
    return null;
  } catch (error) {
    console.error(`Erro na estratégia RSI para ${symbol}:`, error);
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
  /** Estratégias a excluir (ex: ['VOLUME_SPIKE'] para dividir em cron separado) */
  exclude?: string[];
}

/**
 * Função principal que executa todas as estratégias ativas
 * @param options.exclude - Nomes de estratégias a excluir (ex: ['VOLUME_SPIKE'])
 */
export async function runAllStrategies(options?: RunAllStrategiesOptions): Promise<number> {
  let signalsCreated = 0;

  try {
    await ensureMissingBuiltinStrategies(prisma);
    // Estratégias ativas — SELECT legado se symbolUniverseId / SymbolUniverse ainda não existirem na BD
    let strategies: StrategyWithUniverseRow[] = await findStrategiesWithUniverseFallback({
      activeOnly: true,
    });

    // Excluir estratégias opcionais (ex: VOLUME_SPIKE em cron separado)
    if (options?.exclude?.length) {
      strategies = strategies.filter((s) => !options!.exclude!.includes(s.name));
      console.log(`📋 Estratégias excluídas: ${options.exclude.join(', ')}`);
    }

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

      // VOLUME_SPIKE_15M usa apenas timeframe 15m
      const timeframesToUse: Timeframe[] =
        strategy.name === 'VOLUME_SPIKE_15M' ? ['15m'] : timeframes;

      // Universo configurado na BD (Scanner 1 / 2) substitui listagens por defeito
      let symbolsToAnalyze = symbols;
      if (strategy.symbolUniverse) {
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
      } else if (strategy.name === 'MA60_CROSSOVER' || strategy.name === 'AFASTAMENTO_MEDIO') {
        const label =
          strategy.name === 'MA60_CROSSOVER' ? 'MA60_CROSSOVER' : 'AFASTAMENTO_MEDIO';
        console.log(`🔍 Buscando símbolos com market cap > 70 milhões para estratégia ${label}...`);
        const highMarketCapSymbols = await fetchSymbolsWithMarketCap(70000000);
        if (highMarketCapSymbols.length > 0) {
          symbolsToAnalyze = highMarketCapSymbols;
          console.log(`✅ Encontrados ${highMarketCapSymbols.length} símbolos com market cap > 70 milhões`);
        } else {
          console.warn('⚠️  Nenhum símbolo com market cap > 70 milhões encontrado, usando lista padrão');
        }
      } else if (strategy.name === 'VOLUME_SPIKE' || strategy.name === 'VOLUME_SPIKE_15M') {
        const maxSymbols = 500;
        const minQuoteVolume = 100000;
        console.log(`🔍 Buscando símbolos por % variação 24h para estratégia ${strategy.name}...`);
        const volumeSymbols = await fetchTopSymbolsBy24hPriceChange(maxSymbols, minQuoteVolume);
        if (volumeSymbols.length > 0) {
          symbolsToAnalyze = volumeSymbols;
          console.log(`✅ Encontrados ${volumeSymbols.length} símbolos (top por % 24h)`);
        }
      }

      // SCANNER_APLUS: execução especial (tem seu próprio loop de símbolos)
      if (strategy.name === 'SCANNER_APLUS') {
        try {
          const scannerConfig = {
            topSymbolsLimit: params.topSymbolsLimit || 50,
            minQuoteVolume: params.minQuoteVolume || 1000000,
            minScore: params.minEntryScore ?? params.minScore ?? 8.5,
            topResultsLimit: params.topNAlerts || 10,
            enableBreakoutRetest: params.enableBreakoutRetest !== false,
            cooldownMinutes: params.cooldownMinutes || 120,
          };
          const { entries } = await runScanner(scannerConfig);
          for (const alert of entries) {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const existing = await prisma.signal.findFirst({
              where: {
                symbol: alert.symbol,
                strategyId: strategy.id,
                timeframe: '15m',
                direction: alert.side === 'LONG' ? 'BUY' : 'SELL',
                generatedAt: { gte: twoHoursAgo },
              },
            });
            if (!existing) {
              await prisma.signal.create({
                data: {
                  symbol: alert.symbol,
                  direction: alert.side === 'LONG' ? 'BUY' : 'SELL',
                  timeframe: '15m',
                  strategyId: strategy.id,
                  strategyName: strategy.displayName,
                  entryPrice: alert.entry,
                  stopLoss: alert.stop,
                  target1: alert.t1,
                  target2: alert.t2,
                  target3: alert.t2,
                  strength: Math.min(100, Math.round(alert.score * 10)),
                  status: 'NEW',
                  extraInfo: JSON.stringify({ setup: alert.setup, reasons: alert.reasons }),
                },
              });
              signalsCreated++;
              console.log(`✅ Scanner A+ sinal: ${alert.symbol} ${alert.side}`);
            }
          }
        } catch (err) {
          console.error('Erro ao executar SCANNER_APLUS:', err);
        }
        continue;
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
              case 'VOLUME_SPIKE':
                signalResult = await runVolumeSpikeStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ Volume Spike sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'VOLUME_SPIKE_15M':
                signalResult = await runVolumeSpike15mStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ Volume Spike 15m sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              case 'RSI':
                signalResult = await runRsiStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ RSI sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
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
              case 'SCANNER_APLUS':
                // Processado no bloco especial acima - não deve chegar aqui
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

