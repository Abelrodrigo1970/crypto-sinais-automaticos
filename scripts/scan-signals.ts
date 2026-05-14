/**
 * Procura criptos com sinais em todas as estratégias (sem gravar na BD).
 * Para scan rápido usa menos símbolos; aumenta os números abaixo para scan completo.
 *
 * Não inicializa SQLite nem corre prisma generate (SKIP_DB_INIT) — evita EPERM no Windows
 * quando o engine Prisma está bloqueado por outro processo.
 */

import { fetchTopSymbolsBy1hPriceChange, type Timeframe } from '../lib/marketData';
import { getBuiltinScanDefinition, UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80, UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 } from '../lib/symbolUniverseDefaults';
import { scanSymbolUniverseSymbols } from '../lib/universeScanner';
import type { SignalResult, StrategyParams } from '../lib/signalEngine';

type StrategyDef = {
  name: string;
  displayName: string;
  getSymbols: () => Promise<string[]>;
  timeframes: Timeframe[];
  getParams: () => StrategyParams;
  run: (symbol: string, tf: Timeframe, params: StrategyParams) => Promise<SignalResult | null>;
};

// Nº de símbolos por estratégia (aumentar para scan completo; reduzir para scan rápido)
const MA60_SYMBOLS = 150;
const MACD_SYMBOLS = 80;

interface FoundSignal {
  symbol: string;
  strategy: string;
  displayName: string;
  direction: string;
  entryPrice: number;
  strength: number;
  timeframe: string;
}

function buildStrategies(se: typeof import('../lib/signalEngine')): StrategyDef[] {
  const {
    runMa60CrossoverStrategy,
    runAfastamentoMedioStrategy,
    runAfastamentoMedio30mStrategy,
    runMacdHistogramStrategy,
    runMacdHistogramPmoStrategy,
    runRsiOverboughtDrop1hStrategy,
    fetchSymbolsWithMarketCap,
  } = se;

  return [
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
      getSymbols: async () => {
        const def = getBuiltinScanDefinition(UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80);
        if (!def) return [];
        return scanSymbolUniverseSymbols(def);
      },
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
        requireSmoothCross: false,
      }),
      run: runAfastamentoMedioStrategy,
    },
    {
      name: 'AFASTAMENTO_MEDIO_30M',
      displayName: 'Afastamento médio 30m (1→2)',
      getSymbols: async () => {
        const def = getBuiltinScanDefinition(UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80);
        if (!def) return [];
        return scanSymbolUniverseSymbols(def);
      },
      timeframes: ['30m'],
      getParams: () => ({
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
      run: runAfastamentoMedio30mStrategy,
    },
    {
      name: 'RSI_OVERBOUGHT_DROP_1H',
      displayName: 'RSI queda 70 + afastamento 12%',
      getSymbols: async () => {
        const def = getBuiltinScanDefinition(UNIVERSE_CODE_SCANNER_1_ABOVE_MA200);
        if (!def) return [];
        return scanSymbolUniverseSymbols(def);
      },
      timeframes: ['1h'],
      getParams: () => ({
        rsiPeriod: 14,
        overboughtLevel: 70,
        minDropPoints: 4,
        minDistancePct: 12,
        maPeriod: 80,
        meanLineType: 'EMA',
        stopLossPct: 0.06,
      }),
      run: runRsiOverboughtDrop1hStrategy,
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
}

async function main() {
  process.env.SKIP_DB_INIT = '1';
  const signalEngine = await import('../lib/signalEngine');
  const STRATEGIES = buildStrategies(signalEngine);

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
            console.log(
              `   ${dir} ${symbol} ${result.direction} @ ${result.entryPrice.toFixed(6)} (força ${result.strength})`
            );
          }
        } catch (_) {
          // ignorar falha por símbolo
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    console.log(`   → ${count} sinal(is) encontrado(s)\n`);
  }

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
