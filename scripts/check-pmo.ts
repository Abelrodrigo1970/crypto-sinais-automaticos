/**
 * Script para verificar valores de PMO de 10 moedas e comparar com TradingView
 */

import { fetchCandles } from '../lib/marketData';
import { calculatePMO, getCloses } from '../lib/indicators';

const symbols = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'ADAUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'DOTUSDT',
  'AVAXUSDT',
  'MATICUSDT',
];

// Parâmetros PMO TradingView: firstLength=35, secondLength=20
// Fórmula: pmo = ema(10 * ema(roc(src, 1), 35), 20)
const firstLength = 35;
const secondLength = 20;

async function checkPMO() {
  console.log('🔍 Verificando valores de PMO para 10 moedas...\n');
  console.log('Parâmetros PMO:');
  console.log(`  - 1st Smoothing Length: ${firstLength}`);
  console.log(`  - 2nd Smoothing Length: ${secondLength}`);
  console.log(`  - Fórmula: ROC(1) → EMA(${firstLength}) → ×10 → EMA(${secondLength}) → PMO\n`);
  console.log('─'.repeat(80));
  console.log(`${'Símbolo'.padEnd(12)} | ${'PMO (4h)'.padEnd(15)} | ${'PMO (1h)'.padEnd(15)}`);
  console.log('─'.repeat(80));

  for (const symbol of symbols) {
    try {
      // Buscar candles 4h
      const candles4h = await fetchCandles(symbol, '4h', firstLength + secondLength + 20);
      const closes4h = getCloses(candles4h);
      const pmo4h = calculatePMO(closes4h, firstLength, secondLength);

      // Buscar candles 1h
      const candles1h = await fetchCandles(symbol, '1h', firstLength + secondLength + 20);
      const closes1h = getCloses(candles1h);
      const pmo1h = calculatePMO(closes1h, firstLength, secondLength);

      const pmo4hStr = pmo4h !== null ? pmo4h.toFixed(4) : 'N/A';
      const pmo1hStr = pmo1h !== null ? pmo1h.toFixed(4) : 'N/A';

      console.log(
        `${symbol.padEnd(12)} | ${pmo4hStr.padEnd(15)} | ${pmo1hStr.padEnd(15)}`
      );

      // Pequeno delay para não sobrecarregar a API
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`Erro ao processar ${symbol}:`, error);
      console.log(`${symbol.padEnd(12)} | ${'ERRO'.padEnd(15)} | ${'ERRO'.padEnd(15)}`);
    }
  }

  console.log('─'.repeat(80));
  console.log('\n✅ Verificação concluída!');
  console.log('\n💡 Compare estes valores com o TradingView usando:');
  console.log('   - Indicator: Price Momentum Oscillator');
  console.log('   - 1st Smoothing Length: 35');
  console.log('   - 2nd Smoothing Length: 20');
  console.log('   - Signal Length: 10 (para signal line apenas)');
}

checkPMO().catch(console.error);
