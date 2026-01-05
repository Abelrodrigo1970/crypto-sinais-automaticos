/**
 * Motor de geração de sinais baseado em indicadores técnicos
 */

import { prisma } from './db';
import { fetchCandles, type Timeframe } from './marketData';
import {
  calculateRSI,
  calculateSMA,
  calculateMACD,
  calculatePMO,
  getCloses,
} from './indicators';
import { runScanner, type ScannerConfig } from './scannerAplus';
import { createEntrySignals } from './multiTimeframeStrategy';

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
 * Estratégia RSI: Gera sinais quando RSI está sobrecomprado ou sobrevendido
 */
async function runRsiStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  // Suspender estratégia RSI em timeframes 1h e 15m (apenas 4h)
  if (timeframe === '1h' || timeframe === '15m') {
    return null;
  }

  const period = params.period || 14;
  const overbought = params.overbought || 69;
  const oversold = params.oversold || 30;

  try {
    const candles = await fetchCandles(symbol, timeframe, period + 20);
    if (candles.length < period + 1) {
      return null;
    }

    const closes = getCloses(candles);
    const rsi = calculateRSI(closes, period);

    if (rsi === null) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    // Sinal de COMPRA quando RSI < oversold
    if (rsi < oversold) {
      const stopLoss = currentPrice * 0.96; // 4% abaixo
      const target1 = currentPrice * 1.20; // 20% acima
      const target2 = currentPrice * 1.20; // 20% acima (mesmo target)
      const target3 = currentPrice * 1.20; // 20% acima (mesmo target)

      // Força baseada na distância do RSI ao limite
      const strength = Math.min(100, Math.round(((oversold - rsi) / oversold) * 100));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({ rsi: rsi.toFixed(2), period, oversold }),
      };
    }

    // Sinal de VENDA quando RSI > overbought
    if (rsi > overbought) {
      const stopLoss = currentPrice * 1.04; // 4% acima
      const target1 = currentPrice * 0.80; // 20% abaixo
      const target2 = currentPrice * 0.80; // 20% abaixo (mesmo target)
      const target3 = currentPrice * 0.80; // 20% abaixo (mesmo target)

      const strength = Math.min(100, Math.round(((rsi - overbought) / (100 - overbought)) * 100));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({ rsi: rsi.toFixed(2), period, overbought }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia RSI para ${symbol}:`, error);
    return null;
  }
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
 * Estratégia Scanner A+: Usa o scanner A+ para gerar sinais de alta qualidade
 */
async function runScannerAplusStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  // O scanner A+ funciona de forma diferente - analisa múltiplos símbolos
  // Por isso, vamos executar o scanner completo e filtrar pelo símbolo
  // Mas para manter compatibilidade, vamos executar apenas para o símbolo solicitado
  
  // Nota: O scanner A+ funciona melhor quando executado para múltiplos símbolos
  // Esta função será chamada por símbolo, mas vamos otimizar depois
  
  try {
    const config: Partial<ScannerConfig> = {
      topSymbolsLimit: params.topSymbolsLimit || 50,
      minQuoteVolume: params.minQuoteVolume || 0,
      minATRPercent: params.minATRPercent || 0.3,
      maxATRPercent: params.maxATRPercent || 2.5,
      minEntryScore: params.minEntryScore || 7,
      topNAlerts: params.topNAlerts || 10, // Aumentar para pegar mais resultados
      enableBreakoutRetest: params.enableBreakoutRetest || false,
      breakoutPeriod: params.breakoutPeriod || 48,
      cooldownMinutes: params.cooldownMinutes || 60,
    };

    // Executar scanner (ele já filtra por top símbolos)
    const result = await runScanner(config);

    // Buscar alerta para o símbolo específico
    const alert = result.entries.find(a => a.symbol === symbol && a.alert_type === 'ENTRY');
    
    if (!alert) {
      return null;
    }

    // Converter Alert para SignalResult
    const direction = alert.side === 'LONG' ? 'BUY' : 'SELL';
    const strength = Math.min(100, Math.round(alert.score * 10)); // Converter score 0-10 para 0-100

    return {
      direction,
      entryPrice: alert.entry,
      stopLoss: alert.stop,
      target1: alert.t1,
      target2: alert.t2,
      target3: undefined,
      strength,
      extraInfo: JSON.stringify({
        setup: alert.setup,
        score: alert.score,
        atr_pct_15m: alert.atr_pct_15m,
        reasons: alert.reasons,
        timeframe: alert.timeframe,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia Scanner A+ para ${symbol}:`, error);
    return null;
  }
}

/**
 * Estratégia Multi-Timeframe (4H + 1H): Análise multi-timeframe com filtros de regime e bias
 */
async function runMultiTimeframeStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  // Esta estratégia funciona apenas com timeframe 1H
  if (timeframe !== '1h') {
    return null;
  }

  try {
    // Buscar candles 1H e 4H (precisamos de bastante histórico)
    const candles1H = await fetchCandles(symbol, '1h', 200);
    const candles4H = await fetchCandles(symbol, '4h', 100);

    if (candles1H.length < 100 || candles4H.length < 60) {
      return null;
    }

    // Criar evaluator
    const { evaluate } = createEntrySignals(candles1H, candles4H);

    // Avaliar o último candle 1H
    const i1H = candles1H.length - 1;
    const signal = evaluate(i1H);

    if (signal.type === 'NONE') {
      return null;
    }

    const currentPrice = candles1H[i1H].close;
    const direction = signal.type === 'LONG' ? 'BUY' : 'SELL';

    // Calcular stop loss e targets (4% stop, 20% target)
    const stopLoss = direction === 'BUY' 
      ? currentPrice * 0.96  // 4% abaixo para LONG
      : currentPrice * 1.04; // 4% acima para SHORT

    const target1 = direction === 'BUY'
      ? currentPrice * 1.20  // 20% acima para LONG
      : currentPrice * 0.80; // 20% abaixo para SHORT

    // Força baseada no regime e bias
    let strength = 50;
    if (signal.regime4H === 'TREND') {
      strength += 20;
    }
    if (signal.bias4H === 'BULL' || signal.bias4H === 'BEAR') {
      strength += 20;
    }
    if (signal.type === 'LONG' && signal.bias4H === 'BULL') {
      strength += 10;
    }
    if (signal.type === 'SHORT' && signal.bias4H === 'BEAR') {
      strength += 10;
    }

    return {
      direction,
      entryPrice: currentPrice,
      stopLoss,
      target1,
      target2: target1,
      target3: target1,
      strength: Math.min(100, strength),
      extraInfo: JSON.stringify({
        reason: signal.reason,
        regime4H: signal.regime4H,
        bias4H: signal.bias4H,
      }),
    };
  } catch (error) {
    console.error(`Erro na estratégia Multi-Timeframe para ${symbol}:`, error);
    return null;
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
 * Estratégia PMO: Gera sinais quando PMO cruza acima/abaixo de zero
 * Apenas no timeframe 4h e apenas nos horários: 8h, 12h, 16h, 20h, 23h
 */
async function runPmoStrategy(
  symbol: string,
  timeframe: Timeframe,
  params: StrategyParams
): Promise<SignalResult | null> {
  // Esta estratégia funciona apenas com timeframe 4h
  if (timeframe !== '4h') {
    return null;
  }

  // Verificar se o horário atual está permitido (8h, 12h, 16h, 20h, 23h)
  if (!isAllowedTime()) {
    return null;
  }

  const rocPeriod = params.rocPeriod || 10;
  const fastPeriod = params.fastPeriod || 5;
  const slowPeriod = params.slowPeriod || 35;

  try {
    const candles = await fetchCandles(symbol, timeframe, rocPeriod + slowPeriod + 20);
    if (candles.length < rocPeriod + slowPeriod + 2) {
      return null;
    }

    const closes = getCloses(candles);
    const pmo = calculatePMO(closes, rocPeriod, fastPeriod, slowPeriod);

    if (pmo === null) {
      return null;
    }

    // Calcula PMO anterior para detectar cruzamento de zero
    const prevCloses = closes.slice(0, -1);
    const prevPmo = calculatePMO(prevCloses, rocPeriod, fastPeriod, slowPeriod);

    if (prevPmo === null) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    // Sinal de COMPRA: PMO cruza acima de zero (de negativo para positivo)
    if (prevPmo.pmo < 0 && pmo.pmo > 0) {
      const stopLoss = currentPrice * 0.96; // 4% abaixo
      const target1 = currentPrice * 1.20; // 20% acima
      const target2 = currentPrice * 1.20;
      const target3 = currentPrice * 1.20;

      // Força baseada no valor absoluto do PMO
      const strength = Math.min(100, Math.max(60, Math.round(Math.abs(pmo.pmo) * 10)));

      return {
        direction: 'BUY',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          pmo: pmo.pmo.toFixed(4),
          prevPmo: prevPmo.pmo.toFixed(4),
          rocPeriod,
          fastPeriod,
          slowPeriod,
        }),
      };
    }

    // Sinal de VENDA: PMO cruza abaixo de zero (de positivo para negativo)
    if (prevPmo.pmo > 0 && pmo.pmo < 0) {
      const stopLoss = currentPrice * 1.04; // 4% acima
      const target1 = currentPrice * 0.80; // 20% abaixo
      const target2 = currentPrice * 0.80;
      const target3 = currentPrice * 0.80;

      const strength = Math.min(100, Math.max(60, Math.round(Math.abs(pmo.pmo) * 10)));

      return {
        direction: 'SELL',
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2,
        target3,
        strength,
        extraInfo: JSON.stringify({
          pmo: pmo.pmo.toFixed(4),
          prevPmo: prevPmo.pmo.toFixed(4),
          rocPeriod,
          fastPeriod,
          slowPeriod,
        }),
      };
    }

    return null;
  } catch (error) {
    console.error(`Erro na estratégia PMO para ${symbol}:`, error);
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
  const rocPeriod = params.rocPeriod || 10;
  const fastPeriodPmo = params.fastPeriodPmo || 5;
  const slowPeriodPmo = params.slowPeriodPmo || 35;
  const pmoBuyThreshold = params.pmoBuyThreshold || -0.5;
  const pmoSellThreshold = params.pmoSellThreshold || 0.5;

  try {
    // Buscar candles suficientes para MACD e PMO
    const maxPeriod = Math.max(slowPeriod + signalPeriod, rocPeriod + slowPeriodPmo) + 20;
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

    // Calcular PMO
    const pmo = calculatePMO(closes, rocPeriod, fastPeriodPmo, slowPeriodPmo);
    if (pmo === null) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    // Sinal de COMPRA: Histograma cruza para cima (de negativo para positivo) E PMO > -0.5
    if (prevMacd.histogram < 0 && macd.histogram > 0 && pmo.pmo > pmoBuyThreshold) {
      const stopLoss = currentPrice * 0.96; // 4% abaixo
      const target1 = currentPrice * 1.20; // 20% acima
      const target2 = currentPrice * 1.20;
      const target3 = currentPrice * 1.20;

      // Força baseada no histograma e PMO
      const histogramStrength = Math.min(50, Math.round(Math.abs(macd.histogram) * 1000));
      const pmoStrength = Math.min(50, Math.round((pmo.pmo - pmoBuyThreshold) * 20));
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
          pmo: pmo.pmo.toFixed(4),
          pmoBuyThreshold,
        }),
      };
    }

    // Sinal de VENDA: Histograma cruza para baixo (de positivo para negativo) E PMO < 0.5
    if (prevMacd.histogram > 0 && macd.histogram < 0 && pmo.pmo < pmoSellThreshold) {
      const stopLoss = currentPrice * 1.04; // 4% acima
      const target1 = currentPrice * 0.80; // 20% abaixo
      const target2 = currentPrice * 0.80;
      const target3 = currentPrice * 0.80;

      // Força baseada no histograma e PMO
      const histogramStrength = Math.min(50, Math.round(Math.abs(macd.histogram) * 1000));
      const pmoStrength = Math.min(50, Math.round((pmoSellThreshold - pmo.pmo) * 20));
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
          pmo: pmo.pmo.toFixed(4),
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

    // Símbolos e timeframes para analisar
    // Linha 316 - Adicione quantas quiser
    const symbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT',
        'DOGEUSDT', 'XRPUSDT', 'DOTUSDT', 'AVAXUSDT',
        'LINKUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'LTCUSDT',
        'DAMAUSDT', 'ZECUSDT', 'ONUSDT', 'PTBUSDT', 'BEATUSDT',
        'KITEUSDT', 'SENTUSDT', 'RIVERUSDT', 'HEMIUSDT', 'ASTERUSDT',
        'XANUSDT', 'BASUSDT', 'WLFIUSDT', '2ZUSDT', 'ENSOUSDT',
        'MITOUSDT', 'MTLUSDT', 'QUSDT', 'CUDISUSDT', 'EVAUSDT',
        'ALLOUSDT', 'PIEVERSEUSDT', 'PIPPINUSDT', 'FOLKSUSDT', 'JSTUSDT',
        'ARCUSDT', 'HUSDT', 'CYSUSDT', 'MOVEUSDT', 'XVSUSDT',
        'BATUSDT', 'GLMUSDT', 'ZEREBROUSDT', 'PEPEUSDT', 'MOGUSDT',
        // Novos símbolos adicionados
        'APRUSDT', 'BOBUSDT', 'CLANKERUSDT', 'GUAUSDT', 'IRUSDT',
        'IRYSUSDT', 'JCTUSDT', 'MMTUSDT', 'NAORISUSDT', 'NIGHTUSDT',
        'POWERUSDT', 'RAVEUSDT', 'RLSUSDT', 'TURTLEUSDT', 'USUSDT',
        'WETUSDT', 'XAUUSDT', 'XPLUSDT', 'ZKPUSDT','EVAAUSDT',
        ];

    const timeframes: Timeframe[] = ['1h', '4h'];

    // Processar Scanner A+ separadamente (ele já analisa múltiplos símbolos)
    const scannerAplusStrategy = strategies.find(s => s.name === 'SCANNER_APLUS' && s.isActive);
    let scannerAplusSignals = 0;
    
    if (scannerAplusStrategy) {
      try {
        console.log('🔍 Executando Scanner A+...');
        const params = JSON.parse(scannerAplusStrategy.params || '{}');
        const config: Partial<ScannerConfig> = {
          topSymbolsLimit: params.topSymbolsLimit || 50,
          minQuoteVolume: params.minQuoteVolume || 0,
          minATRPercent: params.minATRPercent || 0.3,
          maxATRPercent: params.maxATRPercent || 2.5,
          minEntryScore: params.minEntryScore || 7,
          topNAlerts: params.topNAlerts || 10,
          enableBreakoutRetest: params.enableBreakoutRetest || false,
          breakoutPeriod: params.breakoutPeriod || 48,
          cooldownMinutes: params.cooldownMinutes || 60,
        };

        const result = await runScanner(config);
        console.log(`📊 Scanner A+ encontrou ${result.entries.length} alertas ENTRY e ${result.preSetups.length} PRE-SETUP`);

        // Salvar cada alerta ENTRY como sinal
        for (const alert of result.entries) {
          if (alert.alert_type === 'ENTRY') {
            // Verificar se já existe sinal similar recente
            const recentSignal = await prisma.signal.findFirst({
              where: {
                symbol: alert.symbol,
                strategyId: scannerAplusStrategy.id,
                timeframe: alert.timeframe,
                direction: alert.side === 'LONG' ? 'BUY' : 'SELL',
                status: { in: ['NEW', 'IN_PROGRESS'] },
                generatedAt: {
                  gte: new Date(Date.now() - 2 * 60 * 60 * 1000), // Últimas 2 horas
                },
              },
            });

            if (!recentSignal) {
              const strength = Math.min(100, Math.round(alert.score * 10));
              
              await prisma.signal.create({
                data: {
                  symbol: alert.symbol,
                  direction: alert.side === 'LONG' ? 'BUY' : 'SELL',
                  timeframe: alert.timeframe,
                  strategyId: scannerAplusStrategy.id,
                  strategyName: scannerAplusStrategy.displayName,
                  entryPrice: alert.entry,
                  stopLoss: alert.stop,
                  target1: alert.t1,
                  target2: alert.t2,
                  target3: undefined,
                  strength,
                  status: 'NEW',
                  extraInfo: JSON.stringify({
                    setup: alert.setup,
                    score: alert.score,
                    atr_pct_15m: alert.atr_pct_15m,
                    reasons: alert.reasons,
                  }),
                },
              });

              signalsCreated++;
              scannerAplusSignals++;
              console.log(
                `✅ Sinal Scanner A+ criado: ${alert.symbol} ${alert.side} (Score: ${alert.score}, Strength: ${strength})`
              );
            } else {
              console.log(`⏭️  Sinal Scanner A+ ignorado (duplicado recente): ${alert.symbol} ${alert.side}`);
            }
          }
        }
        
        if (scannerAplusSignals > 0) {
          console.log(`✨ Scanner A+ gerou ${scannerAplusSignals} novo(s) sinal(is)`);
        } else {
          console.log(`ℹ️  Scanner A+ não gerou novos sinais`);
        }
      } catch (error) {
        console.error('❌ Erro ao executar Scanner A+:', error);
      }
    }

    for (const strategy of strategies) {
      // Pular Scanner A+ pois já foi processado acima
      if (strategy.name === 'SCANNER_APLUS') {
        continue;
      }

      const params = JSON.parse(strategy.params || '{}');

      for (const symbol of symbols) {
        for (const timeframe of timeframes) {
          try {
            let signalResult: SignalResult | null = null;

            // Executa a estratégia correspondente
            switch (strategy.name) {
              case 'RSI':
                signalResult = await runRsiStrategy(symbol, timeframe, params);
                break;
              case 'MACD_HISTOGRAM':
                signalResult = await runMacdHistogramStrategy(symbol, timeframe, params);
                break;
              case 'MULTI_TIMEFRAME':
                signalResult = await runMultiTimeframeStrategy(symbol, timeframe, params);
                break;
              case 'PMO':
                signalResult = await runPmoStrategy(symbol, timeframe, params);
                break;
              case 'MACD_HISTOGRAM_PMO':
                signalResult = await runMacdHistogramPmoStrategy(symbol, timeframe, params);
                break;
              case 'SCANNER_APLUS':
                // Scanner A+ funciona de forma diferente - executa uma vez para todos os símbolos
                // Vamos pular aqui e processar depois de forma otimizada
                continue;
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
                  `Sinal criado: ${symbol} ${signalResult.direction} (${strategy.displayName})`
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

