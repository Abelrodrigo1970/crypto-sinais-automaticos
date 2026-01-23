/**
 * Diagnóstico específico para ADAUSDT - comparar com TradingView
 * TradingView mostra: -0.5853046387 (linha azul PMO)
 * Nosso cálculo mostra: 3.0486
 */

import { fetchCandles } from '../lib/marketData';
import { calculatePMO, getCloses } from '../lib/indicators';
import { EMA } from 'technicalindicators';

const symbol = 'ADAUSDT';
const timeframe = '1h';

// Parâmetros PMO TradingView
const rocPeriod = 35;
const emaFast = 20;
const emaSlow = 10;

async function diagnoseADA() {
  console.log(`🔍 Diagnóstico PMO para ${symbol} (${timeframe})\n`);
  console.log(`TradingView mostra: -0.5853046387 (linha azul PMO)\n`);

  // Testar com diferentes quantidades de candles
  const limits = [85, 100, 150, 200, 300];

  for (const limit of limits) {
    console.log('═'.repeat(80));
    console.log(`📊 Testando com ${limit} candles:`);
    console.log('─'.repeat(80));

    try {
      const candles = await fetchCandles(symbol, timeframe, limit);
      const closes = getCloses(candles);

      console.log(`✅ Candles obtidos: ${candles.length}`);
      console.log(`   Primeiro: ${closes[0].toFixed(6)} (${new Date(candles[0].timestamp).toISOString()})`);
      console.log(`   Último: ${closes[closes.length - 1].toFixed(6)} (${new Date(candles[candles.length - 1].timestamp).toISOString()})`);

      // Calcular ROC
      const roc: number[] = [];
      for (let i = rocPeriod; i < closes.length; i++) {
        const change = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
        roc.push(change);
      }

      console.log(`\n📈 ROC: ${roc.length} valores`);
      if (roc.length >= 5) {
        console.log(`   Últimos 5: ${roc.slice(-5).map(v => v.toFixed(4)).join(', ')}`);
      }

      // Calcular EMA20 no ROC
      if (roc.length >= emaFast) {
        const emaFastValues = EMA.calculate({
          values: roc,
          period: emaFast,
        });

        console.log(`\n📊 EMA(${emaFast}) no ROC: ${emaFastValues.length} valores`);
        if (emaFastValues.length >= 5) {
          console.log(`   Últimos 5: ${emaFastValues.slice(-5).map(v => v.toFixed(6)).join(', ')}`);
        }

        // Calcular EMA10 no resultado da EMA20
        if (emaFastValues.length >= emaSlow) {
          const emaSlowValues = EMA.calculate({
            values: emaFastValues,
            period: emaSlow,
          });

          console.log(`\n📊 EMA(${emaSlow}) no resultado: ${emaSlowValues.length} valores`);
          if (emaSlowValues.length >= 5) {
            console.log(`   Últimos 5: ${emaSlowValues.slice(-5).map(v => v.toFixed(6)).join(', ')}`);
          }

          // Calcular PMO
          if (emaFastValues.length > 0 && emaSlowValues.length > 0) {
            const lastFast = emaFastValues[emaFastValues.length - 1];
            const lastSlow = emaSlowValues[emaSlowValues.length - 1];
            const pmo = (lastFast - lastSlow) * 10;

            console.log(`\n🎯 PMO:`);
            console.log(`   EMA${emaFast} (último): ${lastFast.toFixed(6)}`);
            console.log(`   EMA${emaSlow} (último): ${lastSlow.toFixed(6)}`);
            console.log(`   Diferença: ${(lastFast - lastSlow).toFixed(6)}`);
            console.log(`   PMO = ${pmo.toFixed(6)}`);
            console.log(`\n   📊 TradingView: -0.5853046387`);
            console.log(`   📊 Nossa calculado: ${pmo.toFixed(6)}`);
            console.log(`   📉 Diferença: ${(pmo - (-0.5853046387)).toFixed(6)}`);

            // Usar função calculatePMO
            const pmoFromFunction = calculatePMO(closes, rocPeriod, emaFast, emaSlow);
            if (pmoFromFunction !== null) {
              console.log(`   ✅ Função calculatePMO: ${pmoFromFunction.toFixed(6)}`);
            }

            // Verificar se há algo errado com os valores
            if (Math.abs(pmo - (-0.5853046387)) > 1) {
              console.log(`\n   ⚠️  DIFERENÇA MUITO GRANDE!`);
              console.log(`   Possíveis causas:`);
              console.log(`   - Timing diferente (vela fechada vs em formação)`);
              console.log(`   - Fonte de dados diferente`);
              console.log(`   - Fórmula de EMA diferente`);
            }
          }
        }
      }

      console.log('');
    } catch (error) {
      console.error(`❌ Erro:`, error);
    }
  }

  console.log('═'.repeat(80));
}

diagnoseADA().catch(console.error);
