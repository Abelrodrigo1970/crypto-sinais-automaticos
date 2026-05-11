/**
 * Testa MA60 Crossover (MA200) com a mesma lógica do signalEngine.
 * Usa top 300 tokens por % 24h (min volume cotação).
 * Uso: npx tsx scripts/test-ma60-crossover.ts [símbolo]
 * Exemplo: npx tsx scripts/test-ma60-crossover.ts BTCUSDT
 * Sem argumentos: testa os 300 tokens (top por % 24h)
 */

import { runMa60CrossoverStrategy } from '../lib/signalEngine';
import { fetchTopSymbolsBy24hPriceChange } from '../lib/marketData';

const TOKENS = 300;
const MIN_QUOTE_VOLUME = 100000;

async function main() {
  const symbolArg = process.argv[2];
  const timeframe = '1h' as const;

  const symbols = symbolArg ? [symbolArg] : await fetchTopSymbolsBy24hPriceChange(TOKENS, MIN_QUOTE_VOLUME);

  const maParams = { maPeriod: 200 };

  console.log('🔍 Testando MA60 Crossover (MA200) – timeframe 1h');
  console.log(`📊 ${symbols.length} tokens (top por % 24h, min $100k)\n`);

  console.log('--- MA60 Crossover (MA200) ---');
  for (const symbol of symbols) {
    try {
      const result = await runMa60CrossoverStrategy(symbol, timeframe, maParams);
      if (result) {
        console.log(`   ✅ ${symbol}: ${result.direction} | entrada ${result.entryPrice.toFixed(4)} | força ${result.strength}`);
      } else {
        console.log(`   ⏭️  ${symbol}: sem sinal`);
      }
    } catch (e) {
      console.log(`   ❌ ${symbol}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log('\n✅ Teste concluído.');
}

main().catch(console.error);
