/**
 * Testar fórmula alternativa do PMO conforme documentação TradingView
 * Segundo documentação: ROC → EMA → multiplica por 10 → EMA → PMO
 * (não: ROC → EMA → EMA → (diferença) × 10)
 */

import { fetchCandles } from '../lib/marketData';
import { getCloses } from '../lib/indicators';
import { EMA } from 'technicalindicators';

const symbol = 'ADAUSDT';
const timeframe = '1h';

const rocPeriod = 35;
const emaFast = 20;
const emaSlow = 10;

/**
 * Fórmula alternativa: ROC → EMA(20) → multiplica por 10 → EMA(10) → PMO
 */
function calculatePMOAlternative(
  closes: number[],
  rocPeriod: number = 35,
  emaFast: number = 20,
  emaSlow: number = 10
): number | null {
  if (closes.length < rocPeriod + emaFast + emaSlow) {
    return null;
  }

  // 1. Calcular ROC(35)
  const roc: number[] = [];
  for (let i = rocPeriod; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
    roc.push(change);
  }

  if (roc.length < emaFast) {
    return null;
  }

  // 2. Aplicar primeira EMA(20) no ROC
  const emaFastValues = EMA.calculate({
    values: roc,
    period: emaFast,
  });

  if (emaFastValues.length < emaSlow) {
    return null;
  }

  // 3. Multiplicar por 10 ANTES de aplicar segunda EMA
  const multiplied = emaFastValues.map(v => v * 10);

  // 4. Aplicar segunda EMA(10) no resultado multiplicado
  const emaSlowValues = EMA.calculate({
    values: multiplied,
    period: emaSlow,
  });

  if (emaSlowValues.length === 0) {
    return null;
  }

  // 5. PMO = último valor da segunda EMA
  const pmo = emaSlowValues[emaSlowValues.length - 1];

  return pmo;
}

/**
 * Fórmula atual: ROC → EMA(20) → EMA(10) → (diferença) × 10
 */
function calculatePMOCurrent(
  closes: number[],
  rocPeriod: number = 35,
  emaFast: number = 20,
  emaSlow: number = 10
): number | null {
  if (closes.length < rocPeriod + emaFast + emaSlow) {
    return null;
  }

  const roc: number[] = [];
  for (let i = rocPeriod; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
    roc.push(change);
  }

  if (roc.length < emaFast) {
    return null;
  }

  const emaFastValues = EMA.calculate({
    values: roc,
    period: emaFast,
  });

  if (emaFastValues.length < emaSlow) {
    return null;
  }

  const emaSlowValues = EMA.calculate({
    values: emaFastValues,
    period: emaSlow,
  });

  if (emaSlowValues.length === 0) {
    return null;
  }

  const lastFast = emaFastValues[emaFastValues.length - 1];
  const lastSlow = emaSlowValues[emaSlowValues.length - 1];
  const pmo = (lastFast - lastSlow) * 10;

  return pmo;
}

async function testFormulas() {
  console.log(`🔍 Testando fórmulas alternativas para ${symbol} (${timeframe})\n`);
  console.log(`TradingView mostra: -0.5853046387\n`);

  const candles = await fetchCandles(symbol, timeframe, 200);
  const closes = getCloses(candles);

  console.log(`✅ Candles obtidos: ${candles.length}`);
  console.log(`   Último preço: ${closes[closes.length - 1].toFixed(6)}\n`);

  // Testar fórmula atual
  const pmoCurrent = calculatePMOCurrent(closes, rocPeriod, emaFast, emaSlow);
  console.log('═'.repeat(80));
  console.log('📊 Fórmula Atual: ROC → EMA(20) → EMA(10) → (EMA20 - EMA10) × 10');
  console.log('─'.repeat(80));
  console.log(`   Resultado: ${pmoCurrent !== null ? pmoCurrent.toFixed(6) : 'N/A'}`);
  if (pmoCurrent !== null) {
    console.log(`   Diferença com TradingView: ${(pmoCurrent - (-0.5853046387)).toFixed(6)}`);
  }

  // Testar fórmula alternativa
  const pmoAlternative = calculatePMOAlternative(closes, rocPeriod, emaFast, emaSlow);
  console.log('\n═'.repeat(80));
  console.log('📊 Fórmula Alternativa: ROC → EMA(20) → ×10 → EMA(10) → PMO');
  console.log('─'.repeat(80));
  console.log(`   Resultado: ${pmoAlternative !== null ? pmoAlternative.toFixed(6) : 'N/A'}`);
  if (pmoAlternative !== null) {
    console.log(`   Diferença com TradingView: ${(pmoAlternative - (-0.5853046387)).toFixed(6)}`);
    if (Math.abs(pmoAlternative - (-0.5853046387)) < Math.abs((pmoCurrent || 0) - (-0.5853046387))) {
      console.log(`   ✅ Esta fórmula está MAIS PRÓXIMA do TradingView!`);
    }
  }

  console.log('\n═'.repeat(80));
}

testFormulas().catch(console.error);
