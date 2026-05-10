/**
 * Procura criptos com sinais em todas as estratégias (sem gravar na BD).
 * Para scan rápido usa menos símbolos; aumenta os números abaixo para scan completo.
 */

import {
  fetchTopSymbolsBy1hPriceChange,
  fetchTopSymbolsBy24hPriceChange,
  fetchTopSymbolsByVolume,
  type Timeframe,
} from '../lib/marketData';
import {
  runVolumeSpikeStrategy,
  runMa60CrossoverStrategy,
  runAfastamentoMedioStrategy,
  runMacdHistogramStrategy,
  runMacdHistogramPmoStrategy,
  fetchSymbolsWithMarketCap,
  type SignalResult,
  type StrategyParams,
} from '../lib/signalEngine';

type StrategyDef = {
  name: string;
  displayName: string;
  getSymbols: () => Promise<string[]>;
  timeframes: Timeframe[];
  getParams: () => StrategyParams;
  run: (symbol: string, tf: Timeframe, params: StrategyParams) => Promise<SignalResult | null>;
};

// Nº de símbolos por estratégia (aumentar para scan completo; reduzir para scan rápido)
const VOLUME_SYMBOLS = 150;
const MA60_SYMBOLS = 150; // fetchSymbolsWithMarketCap devolve todos; limitamos no loop
const AFASTAMENTO_SYMBOLS = 150;
const MACD_SYMBOLS = 80;

const STRATEGIES: StrategyDef[] = [
  {
    name: 'VOLUME_SPIKE',
    displayName: 'Volume Spike',
    getSymbols: () => fetchTopSymbolsBy24hPriceChange(VOLUME_SYMBOLS, 100000),
    timeframes: ['1h'],
    getParams: () => ({ volumeMultiplier: 6, lookbackHours: 20 }),
    run: runVolumeSpikeStrategy,
  },
  {
    name: 'MA60_CROSSOVER',
    displayName: 'MA60 Crossover',
    getSymbols: async () => (await fetchSymbolsWithMarketCap(70000000)).slice(0, MA60_SYMBOLS),
    timeframes: ['1h'],
    getParams: () => ({ maPeriod: 200 }),
    run: runMa60CrossoverStrategy,
  },
  {
    name: 'AFASTAMENTO_MEDIO',
    displayName: 'Afastamento médio',
    getSymbols: async () =>
      (await fetchSymbolsWithMarketCap(70000000)).slice(0, AFASTAMENTO_SYMBOLS),
    timeframes: ['1h'],
    getParams: () => ({
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
    run: runAfastamentoMedioStrategy,
  },
  {
    name: 'MACD_HISTOGRAM_PMO',
    displayName: 'MACD Histogram + PMO',
    getSymbols: () => fetchTopSymbolsBy1hPriceChange(MACD_SYMBOLS, 150),
    timeframes: ['1h'],
    getParams: () => ({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      pmoBuyThreshold: -0.5,
      pmoSellThreshold: 0.5,
      rocPeriodPmo: 35,
      emaFastPmo: 20,
    }),
    run: runMacdHistogramPmoStrategy,
  },
  {
    name: 'MACD_HISTOGRAM',
    displayName: 'MACD Histogram 4h',
    getSymbols: () => fetchTopSymbolsBy1hPriceChange(MACD_SYMBOLS, 150),
    timeframes: ['4h'],
    getParams: () => ({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      earlyEntryThreshold: 0.001,
    }),
    run: runMacdHistogramStrategy,
  },
];

interface FoundSignal {
  symbol: string;
  strategy: string;
  displayName: string;
  direction: string;
  entryPrice: number;
  strength: number;
  timeframe: string;
}

async function main() {
  console.log('🔍 A procurar criptos com sinais (todas as estratégias)...\n');

  const allSignals: FoundSignal[] = [];

  for (const strat of STRATEGIES) {
    console.log(`📊 ${strat.displayName}: a buscar símbolos...`);
    const symbols = await strat.getSymbols();
    console.log(`   ${symbols.length} símbolos | timeframes: ${strat.timeframes.join(', ')}`);

    const params = strat.getParams();
    let count = 0;

    for (const symbol of symbols) {
      for (const tf of strat.timeframes) {
        try {
          const result = await strat.run(symbol, tf, params);
          if (result) {
            allSignals.push({
              symbol,
              strategy: strat.name,
              displayName: strat.displayName,
              direction: result.direction,
              entryPrice: result.entryPrice,
              strength: result.strength,
              timeframe: tf,
            });
            count++;
            const dir = result.direction === 'BUY' ? '🟢' : '🔴';
            console.log(`   ${dir} ${symbol} ${result.direction} @ ${result.entryPrice.toFixed(6)} (força ${result.strength})`);
          }
        } catch (_) {
          // ignorar falha por símbolo
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    console.log(`   → ${count} sinal(is) encontrado(s)\n`);
  }

  // Resumo
  console.log('═'.repeat(80));
  console.log('📋 RESUMO – Criptos com sinais');
  console.log('═'.repeat(80));

  if (allSignals.length === 0) {
    console.log('Nenhum sinal encontrado neste momento.');
    return;
  }

  const byStrategy = STRATEGIES.map((s) => ({
    name: s.displayName,
    count: allSignals.filter((x) => x.strategy === s.name).length,
  }));

  byStrategy.forEach(({ name, count }) => {
    if (count > 0) console.log(`   ${name}: ${count}`);
  });

  console.log(`\n   Total: ${allSignals.length} sinal(is)`);
  console.log('\nLista por estratégia:\n');

  for (const strat of STRATEGIES) {
    const list = allSignals.filter((x) => x.strategy === strat.name);
    if (list.length === 0) continue;
    console.log(`  ${strat.displayName}:`);
    list.forEach((s) => {
      const dir = s.direction === 'BUY' ? '🟢' : '🔴';
      console.log(`    ${dir} ${s.symbol} ${s.direction} @ ${s.entryPrice.toFixed(6)} (${s.timeframe})`);
    });
    console.log('');
  }
}

main().catch(console.error);
