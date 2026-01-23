/**
 * Script para testar diretamente a criação de um sinal MA60 no banco
 * Simula o que acontece quando um sinal é encontrado
 */

import { PrismaClient } from '@prisma/client';
import { fetchCandles } from '../lib/marketData';
import { calculateSMA, getCloses } from '../lib/indicators';

const prisma = new PrismaClient();

async function testDirectMa60Signal(symbol: string) {
  try {
    console.log(`\n🔍 Testando criação direta de sinal MA60 para ${symbol}...\n`);

    // Buscar estratégia
    const strategy = await prisma.strategy.findFirst({
      where: { name: 'MA60_CROSSOVER' },
    });

    if (!strategy) {
      console.log('❌ Estratégia MA60_CROSSOVER não encontrada!');
      return;
    }

    // Buscar candles
    const timeframe = '1h';
    const maPeriod = 60;
    const candles = await fetchCandles(symbol, timeframe, maPeriod + 20);
    
    if (candles.length < maPeriod + 2) {
      console.log(`❌ Candles insuficientes: ${candles.length}`);
      return;
    }

    const closes = getCloses(candles);
    const currentMA = calculateSMA(closes, maPeriod);
    const prevCloses = closes.slice(0, -1);
    const prevMA = calculateSMA(prevCloses, maPeriod);

    if (currentMA === null || prevMA === null) {
      console.log('❌ Não foi possível calcular MA60');
      return;
    }

    const currentPrice = candles[candles.length - 1].close;
    const prevPrice = candles[candles.length - 2].close;

    console.log(`   Preço anterior: ${prevPrice.toFixed(6)}`);
    console.log(`   MA60 anterior: ${prevMA.toFixed(6)}`);
    console.log(`   Preço atual: ${currentPrice.toFixed(6)}`);
    console.log(`   MA60 atual: ${currentMA.toFixed(6)}`);

    // Verificar se há sinal
    const buySignal = prevPrice < prevMA && currentPrice > currentMA;
    const sellSignal = prevPrice > prevMA && currentPrice < currentMA;

    if (!buySignal && !sellSignal) {
      console.log('\n⚠️  Nenhum sinal de cruzamento encontrado para este símbolo.');
      console.log('   Isso é normal - a estratégia só gera sinais quando há cruzamento.');
      return;
    }

    const direction = buySignal ? 'BUY' : 'SELL';
    const stopLoss = buySignal ? currentPrice * 0.96 : currentPrice * 1.04;
    const target1 = buySignal ? currentPrice * 1.20 : currentPrice * 0.80;
    const distanceFromMA = buySignal 
      ? ((currentPrice - currentMA) / currentMA) * 100
      : ((currentMA - currentPrice) / currentMA) * 100;
    const strength = Math.min(100, Math.max(60, Math.round(50 + Math.abs(distanceFromMA) * 2)));

    console.log(`\n✅ Sinal encontrado: ${direction}`);
    console.log(`   Força: ${strength}`);
    console.log(`   Distância da MA: ${distanceFromMA.toFixed(2)}%`);

    // Verificar se já existe sinal recente
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const recentSignal = await prisma.signal.findFirst({
      where: {
        symbol,
        strategyId: strategy.id,
        timeframe,
        direction,
        status: { in: ['NEW', 'IN_PROGRESS'] },
        generatedAt: {
          gte: twoHoursAgo,
        },
      },
    });

    if (recentSignal) {
      console.log(`\n⏭️  Sinal duplicado - já existe um sinal ${direction} para ${symbol} nas últimas 2 horas`);
      console.log(`   Sinal existente criado em: ${recentSignal.generatedAt.toLocaleString()}`);
      return;
    }

    // Criar sinal
    const signal = await prisma.signal.create({
      data: {
        symbol,
        direction,
        timeframe,
        strategyId: strategy.id,
        strategyName: strategy.displayName,
        entryPrice: currentPrice,
        stopLoss,
        target1,
        target2: target1,
        target3: target1,
        strength,
        status: 'NEW',
        extraInfo: JSON.stringify({
          ma60: currentMA.toFixed(4),
          prevPrice: prevPrice.toFixed(4),
          currentPrice: currentPrice.toFixed(4),
          distanceFromMA: distanceFromMA.toFixed(2),
          maPeriod,
        }),
      },
    });

    console.log(`\n✅ Sinal criado com sucesso no banco!`);
    console.log(`   ID: ${signal.id}`);
    console.log(`   Símbolo: ${signal.symbol}`);
    console.log(`   Direção: ${signal.direction}`);
    console.log(`   Força: ${signal.strength}`);
    console.log(`   Preço entrada: ${signal.entryPrice.toFixed(6)}`);

    // Verificar se o sinal aparece na API
    const signalsFromApi = await prisma.signal.findMany({
      where: {
        strategyId: strategy.id,
        strength: { gte: 40 },
      },
      orderBy: { generatedAt: 'desc' },
      take: 5,
    });

    console.log(`\n📊 Últimos 5 sinais MA60 no banco (força >= 40):`);
    signalsFromApi.forEach(s => {
      const age = Math.round((Date.now() - s.generatedAt.getTime()) / 1000 / 60);
      console.log(`   • ${s.symbol} ${s.direction} | Força: ${s.strength} | ${age}min atrás`);
    });

  } catch (error: any) {
    console.error(`❌ Erro:`, error.message);
  }
}

async function main() {
  console.log('🔍 Testando criação direta de sinal MA60...\n');

  // Testar com símbolos que sabemos que têm sinais
  const testSymbols = ['AAVEUSDT', 'HBARUSDT', 'STXUSDT', 'AIAUSDT'];

  for (const symbol of testSymbols) {
    await testDirectMa60Signal(symbol);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n═'.repeat(80));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
