import type { PrismaClient } from '@prisma/client';

/**
 * Estratégias que o código espera existir em `Strategy` (alinhado a `prisma/seed.ts`).
 * BDs antigas ou seeds incompletos podem não ter linhas — criamos só o que falta (não altera as existentes).
 */
const BUILTIN_STRATEGY_SEEDS: Array<{
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  params: string;
}> = [
  {
    name: 'RSI',
    displayName: 'RSI Sobrecomprado/Sobrevendido',
    description:
      'Gera sinais quando o RSI (Relative Strength Index) está sobrecomprado (acima de 70) ou sobrevendido (abaixo de 30).',
    isActive: true,
    params: JSON.stringify({ period: 14, overbought: 70, oversold: 30 }),
  },
  {
    name: 'MACD_HISTOGRAM',
    displayName: 'Cruzamento do Histograma MACD',
    description:
      'Gera sinais baseado no cruzamento do histograma MACD pela linha zero. Sinal de compra quando histograma cruza de negativo para positivo, e venda quando cruza de positivo para negativo.',
    isActive: true,
    params: JSON.stringify({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }),
  },
  {
    name: 'SCANNER_APLUS',
    displayName: 'Scanner A+ Trades',
    description:
      'Scanner avançado melhorado que identifica setups de alta qualidade (TREND_PULLBACK e BREAKOUT_RETEST) usando análise multi-timeframe (1H + 15m) com sistema de score 0-10. Apenas sinais com score >= 8.5 são gerados. Filtros mais rigorosos para melhor qualidade.',
    isActive: true,
    params: JSON.stringify({
      topSymbolsLimit: 50,
      minQuoteVolume: 1000000,
      minATRPercent: 0.5,
      maxATRPercent: 2.0,
      minEntryScore: 8.5,
      topNAlerts: 10,
      enableBreakoutRetest: true,
      breakoutPeriod: 48,
      cooldownMinutes: 120,
    }),
  },
  {
    name: 'MULTI_TIMEFRAME',
    displayName: 'Multi-Timeframe 4H+1H',
    description:
      'Estratégia multi-timeframe que combina análise 4H (regime RANGE/TREND + bias BULL/BEAR) com entradas no 1H. Em RANGE: entradas por rejeição nas Bollinger Bands. Em TREND: entradas por Breakout + Reteste usando Donchian Channel.',
    isActive: true,
    params: JSON.stringify({}),
  },
  {
    name: 'PMO',
    displayName: 'Price Momentum Oscillator',
    description:
      'Gera sinais quando o PMO cruza acima de zero (compra) ou abaixo de zero (venda). PMO é baseado em EMA da taxa de mudança de preço (ROC). Funciona apenas no timeframe 4h e apenas nos horários: 8h, 12h, 16h, 20h, 23h.',
    isActive: true,
    params: JSON.stringify({ rocPeriod: 35, emaFast: 20, emaSlow: 10 }),
  },
  {
    name: 'MACD_HISTOGRAM_PMO',
    displayName: 'MACD Histogram 1h + PMO',
    description:
      'Combina cruzamento do histograma MACD (1h) com filtro PMO. COMPRA: histograma cruza para cima E PMO > -0.5. VENDA: histograma cruza para baixo E PMO < 0.5.',
    isActive: true,
    params: JSON.stringify({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      rocPeriodPmo: 35,
      emaFastPmo: 20,
      emaSlowPmo: 10,
      pmoBuyThreshold: -0.5,
      pmoSellThreshold: 0.5,
    }),
  },
  {
    name: 'AFASTAMENTO_MEDIO',
    displayName: 'Afastamento médio (80/7)',
    description:
      'EMA80 + suavização 7; COMPRA: cruza 3 após zona ≤2, preço > EMA30. Timeframe 1h; símbolos com market cap > 70M.',
    isActive: true,
    params: JSON.stringify({
      maPeriod: 80,
      smoothPeriod: 7,
      meanLineType: 'EMA',
      trendMaType: 'EMA',
      upperThresholdPct: 60,
      lowerThresholdPct: -60,
      buyTrendMaPeriod: 30,
      buySmoothPrevMax: 2,
      buySmoothCurrMin: 3,
      buySmoothLookback: 12,
      requireSmoothCross: false,
    }),
  },
  {
    name: 'MA60_CROSSOVER',
    displayName: 'MA60 Crossover 1h',
    description:
      'Gera sinais quando o preço cruza a média móvel de 200 períodos. COMPRA: preço cruza acima da MA200. VENDA: preço cruza abaixo da MA200. Timeframe 1h. Apenas para símbolos com market cap > 70 milhões.',
    isActive: true,
    params: JSON.stringify({ maPeriod: 200 }),
  },
  {
    name: 'VOLUME_SPIKE',
    displayName: 'Volume Spike 1h',
    description:
      'Gera sinais quando o volume do último candle fechado é maior que 12 vezes a média das últimas 20 horas. COMPRA: volume spike com preço a subir. VENDA: volume spike com preço a descer. Timeframe 1h.',
    isActive: true,
    params: JSON.stringify({ volumeMultiplier: 12, lookbackHours: 20 }),
  },
  {
    name: 'VOLUME_SPIKE_15M',
    displayName: '15MVolume',
    description:
      'Igual ao Volume Spike 1h mas em timeframe 15m com 15 períodos. Volume do último candle 15m fechado > 12x a média dos últimos 15 candles. COMPRA: preço a subir. VENDA: preço a descer.',
    isActive: true,
    params: JSON.stringify({ volumeMultiplier: 12, lookbackPeriods: 15 }),
  },
];

export async function ensureMissingBuiltinStrategies(prisma: PrismaClient): Promise<void> {
  for (const def of BUILTIN_STRATEGY_SEEDS) {
    const existing = await prisma.strategy.findUnique({ where: { name: def.name } });
    if (!existing) {
      await prisma.strategy.create({ data: def });
    }
  }
}
