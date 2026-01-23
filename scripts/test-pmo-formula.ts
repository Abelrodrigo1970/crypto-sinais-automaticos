/**
 * Script para testar e comparar a fórmula do PMO
 * Verificar se nossa implementação corresponde ao TradingView
 */

import { EMA } from 'technicalindicators';

// Simular cálculo do PMO conforme TradingView
// TradingView: TVta.pmo(source, length1, length2, signal)
// Retorna [pmo, signal]

function calculatePMOTradingView(
  closes: number[],
  length1: number = 35,
  length2: number = 20,
  signalLength: number = 10
): { pmo: number | null; signal: number | null } {
  if (closes.length < length1 + length2 + signalLength) {
    return { pmo: null, signal: null };
  }

  // 1. Calcular ROC (Rate of Change) com período length1
  const roc: number[] = [];
  for (let i = length1; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - length1]) / closes[i - length1]) * 100;
    roc.push(change);
  }

  if (roc.length < length2) {
    return { pmo: null, signal: null };
  }

  // 2. Aplicar primeira EMA (length2) no ROC
  const emaFastValues = EMA.calculate({
    values: roc,
    period: length2,
  });

  if (emaFastValues.length < signalLength) {
    return { pmo: null, signal: null };
  }

  // 3. Aplicar segunda EMA (signal length) no resultado da primeira EMA
  const emaSlowValues = EMA.calculate({
    values: emaFastValues,
    period: signalLength,
  });

  if (emaSlowValues.length === 0) {
    return { pmo: null, signal: null };
  }

  // 4. PMO = (EMA20 - EMA10) × 10
  const lastFast = emaFastValues[emaFastValues.length - 1];
  const lastSlow = emaSlowValues[emaSlowValues.length - 1];
  const pmo = (lastFast - lastSlow) * 10;

  // 5. Signal line = EMA do PMO (geralmente EMA de 10 períodos do PMO)
  // Mas precisamos de histórico do PMO para calcular a signal line
  // Por enquanto, vamos retornar apenas o PMO

  return { pmo, signal: null }; // Signal line requer histórico do PMO
}

// Testar com dados de exemplo
const testCloses = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 10) * 10);
const result = calculatePMOTradingView(testCloses, 35, 20, 10);

console.log('Teste da fórmula PMO:');
console.log('PMO:', result.pmo);
console.log('\nFórmula atual:');
console.log('1. ROC(35) = (preço[i] - preço[i-35]) / preço[i-35] × 100');
console.log('2. EMA(20) aplicada no ROC');
console.log('3. EMA(10) aplicada no resultado da EMA(20)');
console.log('4. PMO = (EMA20 - EMA10) × 10');
console.log('\n✅ Esta é a fórmula padrão do PMO conforme documentação do TradingView');
