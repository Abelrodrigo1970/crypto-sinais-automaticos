/**
 * Motor de geração de sinais baseado em indicadores técnicos
 */

import { prisma } from './db';
import { fetchCandles, fetchTopSymbolsByVolume, type Timeframe } from './marketData';
import {
  calculateSMA,
  calculateMACD,
  calculatePMO,
  getCloses,
  getVolumes,
  calculateVolumeMA,
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
async function runMacdHistogramStrategy(
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
async function runMacdHistogramPmoStrategy(
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
 * Estratégia MA60 Crossover 1H: Gera sinais quando preço cruza a média móvel de 60 períodos
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

  const maPeriod = params.maPeriod || 60;
  const ma200Period = 200; // Filtro de tendência

  try {
    // Buscar candles suficientes para calcular MA60 e MA200
    const candlesNeeded = Math.max(maPeriod, ma200Period) + 20;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    if (candles.length < Math.max(maPeriod, ma200Period) + 2) {
      return null;
    }

    const closes = getCloses(candles);
    
    // Calcular média móvel de 60 períodos atual
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

    // Sinal de COMPRA: Preço cruza acima da MA60 E preço está acima da MA200 (tendência de alta)
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
          ma60: currentMA.toFixed(4),
          ma200: currentMA200.toFixed(4),
          prevPrice: prevPrice.toFixed(4),
          currentPrice: currentPrice.toFixed(4),
          distanceFromMA: distanceFromMA.toFixed(2),
          distanceFromMA200: ((currentPrice - currentMA200) / currentMA200 * 100).toFixed(2),
          maPeriod,
        }),
      };
    }

    // Sinal de VENDA: Preço cruza abaixo da MA60 E preço está abaixo da MA200 (tendência de baixa)
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
          ma60: currentMA.toFixed(4),
          ma200: currentMA200.toFixed(4),
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
 * Estratégia Volume Spike: Gera sinais quando volume é maior que 6 vezes a média das últimas 20 horas
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

  const volumeMultiplier = params.volumeMultiplier || 6; // Múltiplo da média de volume
  const lookbackHours = params.lookbackHours || 20; // Período para calcular média de volume

  try {
    // Buscar candles suficientes (20 horas + alguns extras para garantir)
    const candlesNeeded = lookbackHours + 5;
    const candles = await fetchCandles(symbol, timeframe, candlesNeeded);
    
    if (candles.length < lookbackHours + 1) {
      return null;
    }

    const volumes = getVolumes(candles);
    const currentVolume = volumes[volumes.length - 1];
    
    // Calcular média de volume das últimas 20 horas (excluindo o candle atual)
    const volumesForAverage = volumes.slice(-lookbackHours - 1, -1); // Últimas 20 horas, excluindo atual
    const volumeAverage = calculateVolumeMA(volumesForAverage, lookbackHours);
    
    if (volumeAverage === null || volumeAverage === 0) {
      return null;
    }

    // Verificar se volume atual é maior que 6 vezes a média
    const volumeRatio = currentVolume / volumeAverage;
    
    if (volumeRatio < volumeMultiplier) {
      return null; // Volume não é suficientemente alto
    }

    const currentPrice = candles[candles.length - 1].close;
    const prevPrice = candles[candles.length - 2].close;
    
    // Determinar direção baseada no movimento de preço
    // Se preço subiu com volume alto = BUY, se caiu = SELL
    const priceChange = currentPrice - prevPrice;
    const direction: 'BUY' | 'SELL' = priceChange >= 0 ? 'BUY' : 'SELL';

    // Calcular stop loss e targets
    if (direction === 'BUY') {
      const stopLoss = currentPrice * 0.96; // 4% abaixo
      const target1 = currentPrice * 1.20; // 20% acima
      const target2 = currentPrice * 1.20;
      const target3 = currentPrice * 1.20;

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
      const stopLoss = currentPrice * 1.04; // 4% acima
      const target1 = currentPrice * 0.80; // 20% abaixo
      const target2 = currentPrice * 0.80;
      const target3 = currentPrice * 0.80;

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



/**
 * Função principal que executa todas as estratégias ativas
 */
export async function runAllStrategies(): Promise<number> {
  let signalsCreated = 0;

  try {
    // Busca todas as estratégias ativas
    const strategies = await prisma.strategy.findMany({
      where: { isActive: true },
    });

    if (strategies.length === 0) {
      console.log('Nenhuma estratégia ativa encontrada');
      return 0;
    }

    // Símbolos: top 150 por volume 24h na Binance Futures (mín. 1M USDT)
    console.log('🔍 Buscando símbolos por volume na Binance Futures...');
    let symbols: string[] = [];
    try {
      symbols = await fetchTopSymbolsByVolume(150, 1_000_000);
      console.log(`✅ Encontrados ${symbols.length} símbolos (top por volume)`);
    } catch (err) {
      console.error('Erro ao buscar símbolos por volume, usando fallback:', err);
      symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
    }

    const timeframes: Timeframe[] = ['1h', '4h'];

    for (const strategy of strategies) {

      const params = JSON.parse(strategy.params || '{}');

      // Para estratégia MA60_CROSSOVER, usar símbolos com market cap > 70 milhões
      let symbolsToAnalyze = symbols;
      if (strategy.name === 'MA60_CROSSOVER') {
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
        for (const timeframe of timeframes) {
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
              case 'VOLUME_SPIKE':
                signalResult = await runVolumeSpikeStrategy(symbol, timeframe, params);
                if (signalResult) {
                  console.log(`✅ Volume Spike sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
                }
                break;
              default:
                console.warn(`Estratégia desconhecida: ${strategy.name}`);
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

