/**
 * Testar PMO com correção baseada na documentação do TradingView
 * TradingView usa: ROC → EMA custom (fator 2/length) → multiplica por 10 → EMA custom → PMO
 */

import { fetchCandles } from '../lib/marketData';
import { getCloses } from '../lib/indicators';

const symbol = 'ETHUSDT';
const timeframe = '1h';

// Parâmetros PMO TradingView
const rocPeriod = 35;
const emaFast = 20;
const emaSlow = 10;

/**
 * Calcula EMA usando fórmula do TradingView: fator = 2/length
 * Primeiro valor usa SMA dos primeiros 'period' valores
 */
function calculateEMATradingView(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  if (values.length < period) return [];
  
  const factor = 2 / period; // TradingView usa 2/length (não 2/(n+1))
  const ema: number[] = [];
  
  // Primeiro valor: média simples dos primeiros 'period' valores
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  const firstEMA = sum / period;
  ema.push(firstEMA);
  
  // Valores subsequentes: EMA com fator 2/length
  for (let i = period; i < values.length; i++) {
    const currentEMA = (values[i] * factor) + (ema[ema.length - 1] * (1 - factor));
    ema.push(currentEMA);
  }
  
  return ema;
}

/**
 * Calcula PMO conforme documentação TradingView
 * Fórmula: ROC(35) → EMA(20) custom → multiplica por 10 → EMA(10) custom → PMO
 * Mas na verdade, segundo o código Pine Script: PMO = (EMA20 - EMA10) × 10
 */
function calculatePMOCorrected(
  closes: number[],
  rocPeriod: number = 35,
  emaFast: number = 20,
  emaSlow: number = 10
): { pmo: number | null; details: any } {
  if (closes.length < rocPeriod + emaFast + emaSlow) {
    return { pmo: null, details: {} };
  }

  // 1. Calcular ROC(35)
  const roc: number[] = [];
  for (let i = rocPeriod; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
    roc.push(change);
  }

  if (roc.length < emaFast) {
    return { pmo: null, details: {} };
  }

  // 2. Aplicar primeira EMA(20) custom no ROC
  const emaFastValues = calculateEMATradingView(roc, emaFast);

  if (emaFastValues.length < emaSlow) {
    return { pmo: null, details: {} };
  }

  // 3. Aplicar segunda EMA(10) custom no resultado da primeira EMA
  const emaSlowValues = calculateEMATradingView(emaFastValues, emaSlow);

  if (emaSlowValues.length === 0) {
    return { pmo: null, details: {} };
  }

  // 4. PMO = (EMA20 - EMA10) × 10
  const lastFast = emaFastValues[emaFastValues.length - 1];
  const lastSlow = emaSlowValues[emaSlowValues.length - 1];
  const pmo = (lastFast - lastSlow) * 10;

  return {
    pmo,
    details: {
      lastFast,
      lastSlow,
      diff: lastFast - lastSlow,
      rocLength: roc.length,
      emaFastLength: emaFastValues.length,
      emaSlowLength: emaSlowValues.length,
      lastRoc: roc[roc.length - 1],
      lastEmaFast: lastFast,
      lastEmaSlow: lastSlow,
    }
  };
}

async function testCorrected() {
  console.log(`🔍 Testando PMO corrigido para ${symbol} (${timeframe})\n`);
  console.log('Usando fórmula TradingView:');
  console.log('  - EMA com fator 2/length (não 2/(n+1))');
  console.log('  - Primeiro valor da EMA = SMA dos primeiros N valores\n');

  const candles = await fetchCandles(symbol, timeframe, 200);
  const closes = getCloses(candles);

  console.log(`✅ Candles obtidos: ${candles.length}`);
  console.log(`   Último preço: ${closes[closes.length - 1].toFixed(4)}`);
  console.log(`   Timestamp: ${new Date(candles[candles.length - 1].timestamp).toISOString()}\n`);

  const result = calculatePMOCorrected(closes, rocPeriod, emaFast, emaSlow);

  console.log('═'.repeat(80));
  console.log('📊 Resultados:');
  console.log('─'.repeat(80));
  
  if (result.pmo !== null) {
    console.log(`   TradingView (esperado): -1.617`);
    console.log(`   PMO corrigido: ${result.pmo.toFixed(4)}`);
    const diff = result.pmo - (-1.617);
    console.log(`   Diferença: ${diff.toFixed(4)}`);
    
    console.log(`\n📈 Valores intermediários:`);
    console.log(`   Último ROC: ${result.details.lastRoc.toFixed(4)}`);
    console.log(`   EMA${emaFast} (último): ${result.details.lastFast.toFixed(6)}`);
    console.log(`   EMA${emaSlow} (último): ${result.details.lastSlow.toFixed(6)}`);
    console.log(`   Diferença: ${result.details.diff.toFixed(6)}`);
    
    if (Math.abs(diff) < 0.1) {
      console.log(`\n   ✅ Muito próximo! A diferença pode ser por timing da vela.`);
    } else if (Math.abs(diff) < 0.5) {
      console.log(`\n   ⚠️  Próximo, mas ainda há diferença.`);
    } else {
      console.log(`\n   ❌ Ainda há diferença significativa.`);
      console.log(`\n   💡 Possíveis causas:`);
      console.log(`      - Timing diferente da vela (fechada vs em formação)`);
      console.log(`      - Fonte de dados diferente (Binance vs TradingView)`);
      console.log(`      - Implementação do TradingView pode ter outras nuances`);
    }
  } else {
    console.log('   ❌ Não foi possível calcular PMO');
  }

  console.log('═'.repeat(80));
}

testCorrected().catch(console.error);
