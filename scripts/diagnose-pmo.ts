/**
 * Script de diagnóstico para comparar PMO com TradingView
 * Analisa valores intermediários e diferentes configurações
 */

import { fetchCandles } from '../lib/marketData';
import { calculatePMO, getCloses } from '../lib/indicators';
import { EMA } from 'technicalindicators';

const symbol = 'ETHUSDT';
const timeframe = '1h';

// Parâmetros PMO TradingView
const rocPeriod = 35;
const emaFast = 20;
const emaSlow = 10;

async function diagnosePMO() {
  console.log(`🔍 Diagnóstico PMO para ${symbol} (${timeframe})\n`);
  console.log('Parâmetros:');
  console.log(`  - ROC Period: ${rocPeriod}`);
  console.log(`  - EMA Fast: ${emaFast}`);
  console.log(`  - EMA Slow: ${emaSlow}\n`);

  // Testar com diferentes quantidades de candles
  const candleLimits = [85, 100, 150, 200, 300];

  for (const limit of candleLimits) {
    console.log('═'.repeat(80));
    console.log(`📊 Testando com ${limit} candles:`);
    console.log('─'.repeat(80));

    try {
      const candles = await fetchCandles(symbol, timeframe, limit);
      const closes = getCloses(candles);

      console.log(`✅ Candles obtidos: ${candles.length}`);
      console.log(`   Primeiro preço: ${closes[0].toFixed(4)} (${new Date(candles[0].timestamp).toISOString()})`);
      console.log(`   Último preço: ${closes[closes.length - 1].toFixed(4)} (${new Date(candles[candles.length - 1].timestamp).toISOString()})`);

      // Calcular ROC
      const roc: number[] = [];
      for (let i = rocPeriod; i < closes.length; i++) {
        const change = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
        roc.push(change);
      }

      console.log(`\n📈 ROC calculado: ${roc.length} valores`);
      if (roc.length > 0) {
        console.log(`   Últimos 5 valores ROC: ${roc.slice(-5).map(v => v.toFixed(4)).join(', ')}`);
      }

      // Calcular EMA20 no ROC
      if (roc.length >= emaFast) {
        const emaFastValues = EMA.calculate({
          values: roc,
          period: emaFast,
        });

        console.log(`\n📊 EMA(${emaFast}) no ROC: ${emaFastValues.length} valores`);
        if (emaFastValues.length > 0) {
          console.log(`   Últimos 5 valores EMA${emaFast}: ${emaFastValues.slice(-5).map(v => v.toFixed(4)).join(', ')}`);
        }

        // Calcular EMA10 no resultado da EMA20
        if (emaFastValues.length >= emaSlow) {
          const emaSlowValues = EMA.calculate({
            values: emaFastValues,
            period: emaSlow,
          });

          console.log(`\n📊 EMA(${emaSlow}) no resultado da EMA${emaFast}: ${emaSlowValues.length} valores`);
          if (emaSlowValues.length > 0) {
            console.log(`   Últimos 5 valores EMA${emaSlow}: ${emaSlowValues.slice(-5).map(v => v.toFixed(4)).join(', ')}`);
          }

          // Calcular PMO
          if (emaFastValues.length > 0 && emaSlowValues.length > 0) {
            const lastFast = emaFastValues[emaFastValues.length - 1];
            const lastSlow = emaSlowValues[emaSlowValues.length - 1];
            const pmo = (lastFast - lastSlow) * 10;

            console.log(`\n🎯 PMO Final:`);
            console.log(`   EMA${emaFast} (último): ${lastFast.toFixed(6)}`);
            console.log(`   EMA${emaSlow} (último): ${lastSlow.toFixed(6)}`);
            console.log(`   Diferença: ${(lastFast - lastSlow).toFixed(6)}`);
            console.log(`   PMO = (${lastFast.toFixed(6)} - ${lastSlow.toFixed(6)}) × 10 = ${pmo.toFixed(4)}`);
            console.log(`\n   ⚠️  TradingView mostra: -1.617`);
            console.log(`   📊 Nossa calculado: ${pmo.toFixed(4)}`);
            console.log(`   📉 Diferença: ${(pmo - (-1.617)).toFixed(4)}`);

            // Usar função calculatePMO para comparar
            const pmoFromFunction = calculatePMO(closes, rocPeriod, emaFast);
            if (pmoFromFunction !== null) {
              console.log(`   ✅ Função calculatePMO: ${pmoFromFunction.toFixed(4)}`);
              if (Math.abs(pmo - pmoFromFunction) > 0.0001) {
                console.log(`   ⚠️  Diferença entre cálculo manual e função!`);
              }
            }
          }
        }
      }

      console.log('');
    } catch (error) {
      console.error(`❌ Erro com ${limit} candles:`, error);
    }
  }

  console.log('═'.repeat(80));
  console.log('\n💡 Análise:');
  console.log('   - Se o PMO muda muito com mais candles, pode ser falta de histórico');
  console.log('   - Se o PMO é consistente mas diferente do TradingView, pode ser tipo de EMA');
  console.log('   - Verifique se o TradingView está usando a mesma vela fechada');
}

diagnosePMO().catch(console.error);
