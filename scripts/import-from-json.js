/**
 * Script para importar dados do JSON para PostgreSQL
 * Usa o Prisma Client PostgreSQL existente (não regenera)
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const jsonFile = process.argv[2] || 'temp-import-data.json';
const jsonPath = path.resolve(process.cwd(), jsonFile);
const postgresUrl = process.argv[3] || process.env.DATABASE_URL;

if (!fs.existsSync(jsonPath)) {
  console.error(`❌ Arquivo JSON não encontrado: ${jsonPath}`);
  process.exit(1);
}

if (!postgresUrl || !postgresUrl.startsWith('postgresql://')) {
  console.error('❌ DATABASE_URL não configurada ou não é PostgreSQL!');
  console.error('\n📋 Uso:');
  console.error('   node scripts/import-from-json.js [json-file] [postgres-url]');
  process.exit(1);
}

console.log('🔄 Importando dados do JSON para PostgreSQL...\n');
console.log(`📦 JSON: ${path.basename(jsonPath)}`);
console.log(`🗄️  PostgreSQL: ${postgresUrl.replace(/:[^:@]+@/, ':****@')}\n`);

const originalDbUrl = process.env.DATABASE_URL;

async function importFromJson() {
  let postgresClient;
  
  try {
    // Carregar dados do JSON
    console.log('📖 Lendo dados do JSON...');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`✅ Encontradas ${data.strategies.length} estratégias`);
    console.log(`✅ Encontrados ${data.signals.length} sinais\n`);
    
    // Conectar ao PostgreSQL
    console.log('🔌 Conectando ao PostgreSQL...');
    process.env.DATABASE_URL = postgresUrl;
    postgresClient = new PrismaClient();
    await postgresClient.$connect();
    console.log('✅ Conectado ao PostgreSQL\n');
    
    // Importar estratégias
    console.log('📥 Importando estratégias...');
    let strategiesImported = 0;
    for (const strategy of data.strategies) {
      try {
        await postgresClient.strategy.upsert({
          where: { name: strategy.name },
          update: {
            displayName: strategy.displayName,
            description: strategy.description,
            isActive: strategy.isActive,
            params: strategy.params,
          },
          create: {
            id: strategy.id,
            name: strategy.name,
            displayName: strategy.displayName,
            description: strategy.description,
            isActive: strategy.isActive,
            params: strategy.params,
            createdAt: new Date(strategy.createdAt),
            updatedAt: new Date(strategy.updatedAt),
          },
        });
        strategiesImported++;
      } catch (error) {
        console.error(`⚠️  Erro ao importar estratégia ${strategy.name}:`, error.message);
      }
    }
    console.log(`✅ ${strategiesImported}/${data.strategies.length} estratégias importadas\n`);
    
    // Importar sinais
    console.log('📥 Importando sinais...');
    let signalsImported = 0;
    let signalsSkipped = 0;
    
    for (const signal of data.signals) {
      try {
        const existing = await postgresClient.signal.findFirst({
          where: {
            symbol: signal.symbol,
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            generatedAt: new Date(signal.generatedAt),
          },
        });
        
        if (existing) {
          signalsSkipped++;
          continue;
        }
        
        // Mapear displayName para name da estratégia
        let strategyName = signal.strategyName || 'RSI';
        if (strategyName === 'RSI Sobrecomprado/Sobrevendido') {
          strategyName = 'RSI';
        } else if (strategyName === 'Scanner A+') {
          strategyName = 'SCANNER_APLUS';
        }
        
        const strategy = await postgresClient.strategy.findUnique({
          where: { name: strategyName },
        });
        
        if (!strategy) {
          console.error(`⚠️  Estratégia "${strategyName}" não encontrada para sinal ${signal.symbol} (original: ${signal.strategyName})`);
          signalsSkipped++;
          continue;
        }
        
        await postgresClient.signal.create({
          data: {
            id: signal.id,
            symbol: signal.symbol,
            direction: signal.direction,
            timeframe: signal.timeframe,
            strategyId: strategy.id,
            strategyName: signal.strategyName,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            target1: signal.target1,
            target2: signal.target2,
            target3: signal.target3,
            strength: signal.strength,
            status: signal.status,
            generatedAt: new Date(signal.generatedAt),
            lastCheckedAt: signal.lastCheckedAt ? new Date(signal.lastCheckedAt) : null,
            extraInfo: signal.extraInfo,
            price24h: signal.price24h,
            result24h: signal.result24h,
            status24h: signal.status24h,
          },
        });
        signalsImported++;
        
        if (signalsImported % 10 === 0) {
          console.log(`   ... ${signalsImported} sinais importados`);
        }
      } catch (error) {
        console.error(`⚠️  Erro ao importar sinal ${signal.symbol} ${signal.direction}:`, error.message);
        console.error(`   Detalhes:`, error);
        signalsSkipped++;
      }
    }
    
    console.log(`\n✅ ${signalsImported}/${data.signals.length} sinais importados`);
    if (signalsSkipped > 0) {
      console.log(`⚠️  ${signalsSkipped} sinais pulados (já existem ou erro)`);
    }
    
    const finalCount = await postgresClient.signal.count();
    console.log(`\n📊 Total de sinais no PostgreSQL: ${finalCount}`);
    
    await postgresClient.$disconnect();
    process.env.DATABASE_URL = originalDbUrl;
    
    console.log('\n✅ Importação concluída com sucesso!');
    
  } catch (error) {
    console.error('\n❌ Erro durante importação:', error.message);
    if (postgresClient) {
      await postgresClient.$disconnect().catch(() => {});
    }
    process.env.DATABASE_URL = originalDbUrl;
    process.exit(1);
  }
}

importFromJson();

