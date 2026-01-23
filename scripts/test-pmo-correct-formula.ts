/**
 * Testar fórmula CORRETA do PMO baseada no código Pine Script do TradingView
 * 
 * Código TradingView:
 * pmo = ema(10 * ema(nz(roc(src, 1)), firstLength), secondLength)
 * signal = ema(pmo, signalLength)
 * 
 * Isso significa:
 * 1. ROC(src, 1) - ROC de 1 período (NÃO 35!)
 * 2. EMA(firstLength=35) no ROC de 1 período
 * 3. Multiplica por 10
 * 4. EMA(secondLength=20) no resultado multiplicado
 * 5. PMO = resultado final
 * 
 * NÃO é: ROC(35) → EMA(20) → EMA(10) → (diferença) × 10
 */

import { fetchCandles } from '../lib/marketData';
import { getCloses } from '../lib/indicators';
import { EMA } from 'technicalindicators';

const symbol = 'ADAUSDT';
const timeframe = '1h';

const firstLength = 35;  // 1st Smoothing Length
const secondLength = 20; // 2nd Smoothing Length
const signalLength = 10; // Signal Length

/**
 * Calcula PMO conforme código Pine Script do TradingView
 */
function calculatePMOCorrect(
  closes: number[],
  firstLength: number = 35,
  secondLength: number = 20
): number | null {
  if (closes.length < firstLength + secondLength + 10) {
    return null;
  }

  // 1. Calcular ROC de 1 período (não 35!)
  const roc1: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
    // nz() substitui NaN por 0
    roc1.push(isNaN(change) ? 0 : change);
  }

  if (roc1.length < firstLength) {
    return null;
  }

  // 2. Aplicar primeira EMA(firstLength=35) no ROC de 1 período
  const ema1 = EMA.calculate({
    values: roc1,
    period: firstLength,
  });

  if (ema1.length < secondLength) {
    return null;
  }

  // 3. Multiplicar por 10
  const multiplied = ema1.map(v => v * 10);

  // 4. Aplicar segunda EMA(secondLength=20) no resultado multiplicado
  const ema2 = EMA.calculate({
    values: multiplied,
    period: secondLength,
  });

  if (ema2.length === 0) {
    return null;
  }

  // 5. PMO = último valor da segunda EMA
  const pmo = ema2[ema2.length - 1];

  return pmo;
}

/**
 * Calcula Signal Line (EMA do PMO)
 */
function calculatePMOSignal(
  pmoValues: number[],
  signalLength: number = 10
): number | null {
  if (pmoValues.length < signalLength) {
    return null;
  }

  const signal = EMA.calculate({
    values: pmoValues,
    period: signalLength,
  });

  return signal.length > 0 ? signal[signal.length - 1] : null;
}

async function testCorrectFormula() {
  console.log(`🔍 Testando fórmula CORRETA do PMO para ${symbol} (${timeframe})\n`);
  console.log('Fórmula TradingView:');
  console.log('  pmo = ema(10 * ema(roc(src, 1), 35), 20)');
  console.log('  signal = ema(pmo, 10)\n');
  console.log(`TradingView mostra: -0.5853046387\n`);

  const candles = await fetchCandles(symbol, timeframe, 200);
  const closes = getCloses(candles);

  console.log(`✅ Candles obtidos: ${candles.length}`);
  console.log(`   Último preço: ${closes[closes.length - 1].toFixed(6)}\n`);

  // Calcular PMO correto
  const pmo = calculatePMOCorrect(closes, firstLength, secondLength);

  console.log('═'.repeat(80));
  console.log('📊 Resultado:');
  console.log('─'.repeat(80));
  
  if (pmo !== null) {
    console.log(`   TradingView (esperado): -0.5853046387`);
    console.log(`   PMO calculado: ${pmo.toFixed(6)}`);
    const diff = pmo - (-0.5853046387);
    console.log(`   Diferença: ${diff.toFixed(6)}`);
    
    if (Math.abs(diff) < 0.1) {
      console.log(`\n   ✅ MUITO PRÓXIMO! A diferença pode ser por timing da vela.`);
    } else if (Math.abs(diff) < 0.5) {
      console.log(`\n   ⚠️  Próximo, mas ainda há diferença.`);
    } else {
      console.log(`\n   ❌ Ainda há diferença.`);
    }

    // Calcular valores intermediários para debug
    const roc1: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const change = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
      roc1.push(isNaN(change) ? 0 : change);
    }
    
    const ema1 = EMA.calculate({ values: roc1, period: firstLength });
    const multiplied = ema1.map(v => v * 10);
    const ema2 = EMA.calculate({ values: multiplied, period: secondLength });

    console.log(`\n📈 Valores intermediários:`);
    console.log(`   ROC(1) último: ${roc1[roc1.length - 1].toFixed(6)}`);
    console.log(`   EMA(${firstLength}) no ROC(1) último: ${ema1[ema1.length - 1].toFixed(6)}`);
    console.log(`   Multiplicado por 10: ${multiplied[multiplied.length - 1].toFixed(6)}`);
    console.log(`   EMA(${secondLength}) último: ${ema2[ema2.length - 1].toFixed(6)}`);
  } else {
    console.log('   ❌ Não foi possível calcular PMO');
  }

  console.log('═'.repeat(80));
}

testCorrectFormula().catch(console.error);
