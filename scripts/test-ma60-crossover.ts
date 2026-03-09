/**
 * Testa MA60 Crossover (MA200) e Volume Spike usando a mesma lógica do signalEngine.
 * Usa o mesmo método de procura do Volume Spike: top 300 tokens por volume 24h.
 * Uso: npx tsx scripts/test-ma60-crossover.ts [símbolo]
 * Exemplo: npx tsx scripts/test-ma60-crossover.ts BTCUSDT
 * Sem argumentos: testa os 300 tokens (top por volume)
 */

import { runMa60CrossoverStrategy, runVolumeSpikeStrategy } from '../lib/signalEngine';
import { fetchTopSymbolsByVolume } from '../lib/marketData';

const TOKENS = 300; // Igual ao Volume Spike (fetchTopSymbolsByVolume)
const MIN_QUOTE_VOLUME = 100000;

async function main() {
  const symbolArg = process.argv[2];
  const timeframe = '1h' as const;

  const symbols = symbolArg ? [symbolArg] : await fetchTopSymbolsByVolume(TOKENS, MIN_QUOTE_VOLUME);

  const maParams = { maPeriod: 200 };
  const volumeParams = { volumeMultiplier: 6, lookbackHours: 20 };

  console.log('🔍 Testando MA60 Crossover (MA200) + Volume Spike – timeframe 1h');
  console.log(`📊 ${symbols.length} tokens (top por volume 24h, min $100k)\n`);

  // --- MA60 Crossover ---
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

  // --- Volume Spike ---
  console.log('\n--- Volume Spike ---');
  for (const symbol of symbols) {
    try {
      const result = await runVolumeSpikeStrategy(symbol, timeframe, volumeParams);
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
