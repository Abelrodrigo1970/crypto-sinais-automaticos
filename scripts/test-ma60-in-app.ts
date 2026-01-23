/**
 * Script que simula exatamente o que a app faz ao executar a estratégia MA60_CROSSOVER
 * Inclui verificação de duplicados e criação no banco
 */

import { PrismaClient } from '@prisma/client';
import { runAllStrategies } from '../lib/signalEngine';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Testando execução da estratégia MA60_CROSSOVER como na app...\n');

  // Verificar se a estratégia existe e está ativa
  const ma60Strategy = await prisma.strategy.findFirst({
    where: { name: 'MA60_CROSSOVER' },
  });

  if (!ma60Strategy) {
    console.log('❌ Estratégia MA60_CROSSOVER não encontrada!');
    console.log('   Execute: npx tsx prisma/seed.ts');
    return;
  }

  if (!ma60Strategy.isActive) {
    console.log('❌ Estratégia MA60_CROSSOVER está INATIVA!');
    console.log('   Ative a estratégia no banco de dados primeiro.');
    return;
  }

  console.log(`✅ Estratégia encontrada e ativa: ${ma60Strategy.displayName}\n`);

  // Contar sinais existentes antes
  const signalsBefore = await prisma.signal.count({
    where: {
      strategyId: ma60Strategy.id,
    },
  });

  console.log(`📊 Sinais MA60 existentes no banco: ${signalsBefore}`);

  // Contar sinais recentes (últimas 2 horas)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const recentSignals = await prisma.signal.findMany({
    where: {
      strategyId: ma60Strategy.id,
      generatedAt: {
        gte: twoHoursAgo,
      },
    },
    orderBy: {
      generatedAt: 'desc',
    },
    take: 10,
  });

  console.log(`📊 Sinais MA60 nas últimas 2 horas: ${recentSignals.length}`);
  if (recentSignals.length > 0) {
    console.log('\n   Últimos sinais:');
    recentSignals.forEach(s => {
      console.log(`   • ${s.symbol} ${s.direction} (${s.timeframe}) - ${s.generatedAt.toLocaleString()}`);
    });
  }

  console.log('\n═'.repeat(80));
  console.log('🚀 Executando runAllStrategies()...');
  console.log('═'.repeat(80));
  console.log('');

  // Executar a função que a app usa
  const signalsCreated = await runAllStrategies();

  console.log('\n═'.repeat(80));
  console.log(`✅ Execução concluída: ${signalsCreated} novo(s) sinal(is) criado(s)`);
  console.log('═'.repeat(80));

  // Contar sinais depois
  const signalsAfter = await prisma.signal.count({
    where: {
      strategyId: ma60Strategy.id,
    },
  });

  console.log(`\n📊 Sinais MA60 no banco após execução: ${signalsAfter}`);

  // Buscar os últimos sinais criados
  const newSignals = await prisma.signal.findMany({
    where: {
      strategyId: ma60Strategy.id,
    },
    orderBy: {
      generatedAt: 'desc',
    },
    take: 10,
  });

  if (newSignals.length > 0) {
    console.log('\n📋 Últimos 10 sinais MA60 no banco:');
    newSignals.forEach(s => {
      const age = Math.round((Date.now() - s.generatedAt.getTime()) / 1000 / 60);
      console.log(`   • ${s.symbol.padEnd(15)} ${s.direction.padEnd(4)} ${s.timeframe.padEnd(3)} | Preço: ${s.entryPrice.toFixed(6).padStart(12)} | Força: ${s.strength} | ${age}min atrás`);
    });
  } else {
    console.log('\n⚠️  Nenhum sinal MA60 encontrado no banco!');
  }

  console.log('\n═'.repeat(80));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
