/**
 * Script para testar criação de sinais MA60 para os símbolos encontrados
 */

import { PrismaClient } from '@prisma/client';
import { fetchCandles } from '../lib/marketData';
import { calculateSMA, getCloses } from '../lib/indicators';

const prisma = new PrismaClient();

async function testAndCreateSignal(symbol: string) {
  try {
    console.log(`\n🔍 Testando ${symbol}...\n`);

    const strategy = await prisma.strategy.findFirst({
      where: { name: 'MA60_CROSSOVER' },
    });

    if (!strategy) {
      console.log('❌ Estratégia não encontrada!');
      return;
    }

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

    const buySignal = prevPrice < prevMA && currentPrice > currentMA;
    const sellSignal = prevPrice > prevMA && currentPrice < currentMA;

    if (!buySignal && !sellSignal) {
      console.log('\n⚠️  Nenhum sinal de cruzamento encontrado.');
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

    // Verificar duplicado
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const recentSignal = await prisma.signal.findFirst({
      where: {
        symbol,
        strategyId: strategy.id,
        timeframe,
        direction,
        status: { in: ['NEW', 'IN_PROGRESS'] },
        generatedAt: { gte: twoHoursAgo },
      },
    });

    if (recentSignal) {
      console.log(`\n⏭️  Sinal duplicado - já existe nas últimas 2 horas`);
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

    console.log(`\n✅ Sinal criado com sucesso!`);
    console.log(`   ID: ${signal.id}`);
    console.log(`   ${signal.symbol} ${signal.direction} | Força: ${signal.strength} | Preço: ${signal.entryPrice.toFixed(6)}`);

  } catch (error: any) {
    console.error(`❌ Erro:`, error.message);
  }
}

async function main() {
  console.log('🔍 Testando criação de sinais MA60 para símbolos encontrados...\n');

  // Símbolos que o script encontrou com sinais
  const symbols = ['WLFIUSDT', 'MOODENGUSDT'];

  for (const symbol of symbols) {
    await testAndCreateSignal(symbol);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Verificar todos os sinais MA60 no banco
  const strategy = await prisma.strategy.findFirst({
    where: { name: 'MA60_CROSSOVER' },
  });

  if (strategy) {
    const allSignals = await prisma.signal.findMany({
      where: { strategyId: strategy.id },
      orderBy: { generatedAt: 'desc' },
      take: 10,
    });

    console.log('\n═'.repeat(80));
    console.log('📊 Últimos 10 sinais MA60 no banco:');
    console.log('─'.repeat(80));
    allSignals.forEach(s => {
      const age = Math.round((Date.now() - s.generatedAt.getTime()) / 1000 / 60);
      console.log(`   • ${s.symbol.padEnd(15)} ${s.direction.padEnd(4)} | Força: ${s.strength.toString().padStart(3)} | Preço: ${s.entryPrice.toFixed(6).padStart(12)} | ${age}min atrás`);
    });
  }

  console.log('\n═'.repeat(80));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
