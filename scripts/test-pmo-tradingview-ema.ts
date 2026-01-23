/**
 * Testar PMO com fórmula de EMA do TradingView
 * TradingView usa EMA com fator 2/length em vez de 2/(n+1)
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
 */
function calculateEMATradingView(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  
  const factor = 2 / period; // TradingView usa 2/length
  const ema: number[] = [];
  
  // Primeiro valor: média simples dos primeiros 'period' valores
  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) {
    sum += values[i];
  }
  const firstEMA = sum / Math.min(period, values.length);
  ema.push(firstEMA);
  
  // Valores subsequentes: EMA padrão com fator 2/length
  for (let i = period; i < values.length; i++) {
    const currentEMA = (values[i] * factor) + (ema[ema.length - 1] * (1 - factor));
    ema.push(currentEMA);
  }
  
  return ema;
}

/**
 * Calcula PMO usando fórmula de EMA do TradingView
 */
function calculatePMOTradingView(
  closes: number[],
  rocPeriod: number = 35,
  emaFast: number = 20,
  emaSlow: number = 10
): number | null {
  if (closes.length < rocPeriod + emaFast + emaSlow) {
    return null;
  }

  // 1. Calcular ROC
  const roc: number[] = [];
  for (let i = rocPeriod; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
    roc.push(change);
  }

  if (roc.length < emaFast) {
    return null;
  }

  // 2. Aplicar primeira EMA (20) no ROC usando fórmula TradingView
  const emaFastValues = calculateEMATradingView(roc, emaFast);

  if (emaFastValues.length < emaSlow) {
    return null;
  }

  // 3. Aplicar segunda EMA (10) no resultado da primeira EMA usando fórmula TradingView
  const emaSlowValues = calculateEMATradingView(emaFastValues, emaSlow);

  if (emaSlowValues.length === 0) {
    return null;
  }

  // 4. PMO = (EMA20 - EMA10) × 10
  const lastFast = emaFastValues[emaFastValues.length - 1];
  const lastSlow = emaSlowValues[emaSlowValues.length - 1];
  const pmo = (lastFast - lastSlow) * 10;

  return pmo;
}

async function testPMO() {
  console.log(`🔍 Testando PMO com fórmula EMA do TradingView para ${symbol} (${timeframe})\n`);
  
  const candles = await fetchCandles(symbol, timeframe, 200);
  const closes = getCloses(candles);

  console.log(`✅ Candles obtidos: ${candles.length}`);
  console.log(`   Último preço: ${closes[closes.length - 1].toFixed(4)}`);
  console.log(`   Timestamp: ${new Date(candles[candles.length - 1].timestamp).toISOString()}\n`);

  // Calcular PMO com fórmula TradingView
  const pmoTV = calculatePMOTradingView(closes, rocPeriod, emaFast, emaSlow);

  console.log('═'.repeat(80));
  console.log('📊 Resultados:');
  console.log('─'.repeat(80));
  console.log(`   TradingView (esperado): -1.617`);
  console.log(`   PMO com EMA TradingView: ${pmoTV !== null ? pmoTV.toFixed(4) : 'N/A'}`);
  
  if (pmoTV !== null) {
    const diff = pmoTV - (-1.617);
    console.log(`   Diferença: ${diff.toFixed(4)}`);
    
    if (Math.abs(diff) < 0.1) {
      console.log(`   ✅ Muito próximo! A diferença pode ser por timing da vela.`);
    } else if (Math.abs(diff) < 0.5) {
      console.log(`   ⚠️  Próximo, mas ainda há diferença.`);
    } else {
      console.log(`   ❌ Ainda há diferença significativa.`);
    }
  }

  console.log('═'.repeat(80));
  console.log('\n💡 Nota:');
  console.log('   - TradingView usa EMA com fator 2/length');
  console.log('   - Biblioteca technicalindicators usa EMA com fator 2/(n+1)');
  console.log('   - Esta diferença pode explicar a discrepância nos valores');
}

testPMO().catch(console.error);
