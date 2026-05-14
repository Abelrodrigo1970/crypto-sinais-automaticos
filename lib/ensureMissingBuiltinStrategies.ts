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
    name: 'MACD_HISTOGRAM',
    displayName: 'Cruzamento do Histograma MACD',
    description:
      'Gera sinais baseado no cruzamento do histograma MACD pela linha zero. Sinal de compra quando histograma cruza de negativo para positivo, e venda quando cruza de positivo para negativo.',
    isActive: true,
    params: JSON.stringify({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }),
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
        'Universo de símbolos: último scan gravado do Scanner 2 (±10% SMA80 em 1h); o motor ignora universo associado na estratégia. EMA80 + SMA(7) do afastamento %; COMPRA: linha 7 de ≤2 para ≥3 com preço > EMA30. Timeframe 1h.',
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
      requireSmoothCross: false,
    }),
  },
  {
    name: 'AFASTAMENTO_MEDIO_30M',
    displayName: 'Afastamento médio 30m (1→2)',
    description:
        'Universo: último scan Scanner 2 (±10% SMA80 em 1h) na BD; o motor ignora universo associado. EMA80 + SMA(7) em 30m; COMPRA: linha suavizada ≤1 → ≥2 com preço > EMA30. VENDA: mesmo limiar +60% que 1h. SL 6%; TP a 18% do preço de entrada; take-profit parcial de 40% da posição (TP1 na Binance).',
    isActive: true,
    params: JSON.stringify({
      maPeriod: 80,
      smoothPeriod: 7,
      meanLineType: 'EMA',
      trendMaType: 'EMA',
      upperThresholdPct: 60,
      lowerThresholdPct: -60,
      buyTrendMaPeriod: 30,
      buySmoothPrevMax: 1,
      buySmoothCurrMin: 2,
      requireSmoothCross: false,
      stopLossPct: 0.06,
      takeProfitPct: 0.18,
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
    name: 'RSI_OVERBOUGHT_DROP_1H',
    displayName: 'RSI queda de 70 (mín. 4 pts) + afastamento >12% (1h)',
    description:
      'Universo: último scan gravado do Scanner 1 (fecho acima SMA200 em 1h); o motor ignora universo associado na estratégia. Timeframe 1h, VENDA: RSI no candle anterior ≥70, no atual <70 com queda de pelo menos 4 pontos (ex.: 72→68), afastamento % do fecho à EMA80 >12%. Stop loss 6% acima do entrada; take profit na EMA80.',
    isActive: true,
    params: JSON.stringify({
      rsiPeriod: 14,
      overboughtLevel: 70,
      minDropPoints: 4,
      minDistancePct: 12,
      maPeriod: 80,
      meanLineType: 'EMA',
      stopLossPct: 0.06,
    }),
  },
];

const REMOVED_STRATEGY_NAMES = ['RSI', 'SCANNER_APLUS', 'VOLUME_SPIKE', 'VOLUME_SPIKE_15M'] as const;

export async function ensureMissingBuiltinStrategies(prisma: PrismaClient): Promise<void> {
  await prisma.strategy.deleteMany({
    where: { name: { in: [...REMOVED_STRATEGY_NAMES] } },
  });

  for (const def of BUILTIN_STRATEGY_SEEDS) {
    const existing = await prisma.strategy.findUnique({ where: { name: def.name } });
    if (!existing) {
      await prisma.strategy.create({ data: def });
    }
  }
}
