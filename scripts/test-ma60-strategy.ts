/**
 * Script para testar a estratégia MA60_CROSSOVER
 * Testa alguns símbolos e mostra os resultados detalhados
 */

import { fetchCandles } from '../lib/marketData';
import { calculateSMA, getCloses } from '../lib/indicators';

async function fetchSymbolsWithMarketCap(minMarketCap: number = 70000000): Promise<string[]> {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!response.ok) {
      throw new Error(`Erro ao buscar símbolos: ${response.statusText}`);
    }

    const data = await response.json();
    const minQuoteVolume = minMarketCap / 10;
    const filteredSymbols = data
      .filter((ticker: any) => {
        return ticker.symbol.endsWith('USDT') && 
               !ticker.symbol.includes('BUSD') &&
               parseFloat(ticker.quoteVolume) >= minQuoteVolume;
      })
      .map((ticker: any) => ticker.symbol);

    return filteredSymbols;
  } catch (error) {
    console.error('Erro ao buscar símbolos com market cap:', error);
    return [];
  }
}

async function testMa60Strategy(symbol: string, maPeriod: number = 60) {
  try {
    const timeframe = '1h';
    const candles = await fetchCandles(symbol, timeframe, maPeriod + 20);
    
    if (candles.length < maPeriod + 2) {
      return {
        symbol,
        success: false,
        error: `Candles insuficientes: ${candles.length} (necessário: ${maPeriod + 2})`,
      };
    }

    const closes = getCloses(candles);
    
    // Calcular média móvel de 60 períodos atual
    const currentMA = calculateSMA(closes, maPeriod);
    if (currentMA === null) {
      return {
        symbol,
        success: false,
        error: 'Não foi possível calcular MA60 atual',
      };
    }

    // Calcular média móvel anterior (sem o último candle)
    const prevCloses = closes.slice(0, -1);
    const prevMA = calculateSMA(prevCloses, maPeriod);
    if (prevMA === null) {
      return {
        symbol,
        success: false,
        error: 'Não foi possível calcular MA60 anterior',
      };
    }

    const currentPrice = candles[candles.length - 1].close;
    const prevPrice = candles[candles.length - 2].close;

    // Verificar condições de sinal
    const buySignal = prevPrice < prevMA && currentPrice > currentMA;
    const sellSignal = prevPrice > prevMA && currentPrice < currentMA;

    const distanceFromMA = ((currentPrice - currentMA) / currentMA) * 100;
    const priceAboveMA = currentPrice > currentMA;

    return {
      symbol,
      success: true,
      currentPrice: currentPrice.toFixed(6),
      prevPrice: prevPrice.toFixed(6),
      ma60: currentMA.toFixed(6),
      prevMA60: prevMA.toFixed(6),
      distanceFromMA: distanceFromMA.toFixed(2),
      priceAboveMA,
      buySignal,
      sellSignal,
      signal: buySignal ? 'BUY' : sellSignal ? 'SELL' : 'NONE',
    };
  } catch (error: any) {
    return {
      symbol,
      success: false,
      error: error.message || 'Erro desconhecido',
    };
  }
}

async function main() {
  console.log('🔍 Testando estratégia MA60_CROSSOVER...\n');

  // Buscar símbolos com market cap > 70 milhões
  console.log('📊 Buscando símbolos com market cap > 70 milhões...');
  const symbols = await fetchSymbolsWithMarketCap(70000000);
  
  if (symbols.length === 0) {
    console.log('❌ Nenhum símbolo encontrado!');
    return;
  }

  console.log(`✅ Encontrados ${symbols.length} símbolos\n`);

  // Testar os primeiros 50 símbolos
  const symbolsToTest = symbols.slice(0, 50);
  console.log(`🧪 Testando ${symbolsToTest.length} símbolos...\n`);
  console.log('═'.repeat(100));

  const results: any[] = [];
  let signalsFound = 0;

  for (const symbol of symbolsToTest) {
    const result = await testMa60Strategy(symbol);
    results.push(result);

    if (result.success) {
      const status = result.signal === 'NONE' ? '⚪' : result.signal === 'BUY' ? '🟢' : '🔴';
      console.log(`${status} ${symbol.padEnd(15)} | Preço: ${result.currentPrice.padStart(12)} | MA60: ${result.ma60.padStart(12)} | Dist: ${result.distanceFromMA.padStart(7)}% | ${result.signal}`);
      
      if (result.signal !== 'NONE') {
        signalsFound++;
        console.log(`   └─ ${result.signal}: Preço anterior ${result.prevPrice} ${result.signal === 'BUY' ? '<' : '>'} MA60 anterior ${result.prevMA60}`);
        console.log(`      Preço atual ${result.currentPrice} ${result.signal === 'BUY' ? '>' : '<'} MA60 atual ${result.ma60}`);
      }
    } else {
      console.log(`❌ ${symbol.padEnd(15)} | Erro: ${result.error}`);
    }

    // Pequeno delay para não sobrecarregar a API
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log('═'.repeat(100));
  console.log('\n📊 RESUMO:');
  console.log('─'.repeat(100));
  console.log(`   Total testado: ${results.length}`);
  console.log(`   Sucesso: ${results.filter(r => r.success).length}`);
  console.log(`   Erros: ${results.filter(r => !r.success).length}`);
  console.log(`   Sinais encontrados: ${signalsFound}`);
  
  const buySignals = results.filter(r => r.success && r.signal === 'BUY');
  const sellSignals = results.filter(r => r.success && r.signal === 'SELL');
  
  if (buySignals.length > 0) {
    console.log(`\n🟢 SINAIS DE COMPRA (${buySignals.length}):`);
    buySignals.forEach(r => {
      console.log(`   ${r.symbol}: Preço ${r.currentPrice} | MA60 ${r.ma60} | Distância ${r.distanceFromMA}%`);
    });
  }
  
  if (sellSignals.length > 0) {
    console.log(`\n🔴 SINAIS DE VENDA (${sellSignals.length}):`);
    sellSignals.forEach(r => {
      console.log(`   ${r.symbol}: Preço ${r.currentPrice} | MA60 ${r.ma60} | Distância ${r.distanceFromMA}%`);
    });
  }

  if (signalsFound === 0) {
    console.log('\n⚠️  Nenhum sinal encontrado nos primeiros 20 símbolos.');
    console.log('   Isso é normal - a estratégia só gera sinais quando há cruzamento da MA60.');
    console.log('   Tente executar novamente em outro momento ou testar mais símbolos.');
  }

  console.log('\n═'.repeat(100));
}

main().catch(console.error);
