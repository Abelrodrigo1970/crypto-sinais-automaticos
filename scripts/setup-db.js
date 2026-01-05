/**
 * Script inteligente para configurar banco de dados
 * Detecta automaticamente se é SQLite ou PostgreSQL e configura adequadamente
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Resolver referências do Railway (ex: ${{Postgres.DATABASE_URL}})
let databaseUrl = process.env.DATABASE_URL || '';

// Se for uma referência do Railway que não foi resolvida, tentar outras variáveis
if (databaseUrl.includes('{{') || databaseUrl === '' || !databaseUrl) {
  // Tentar variáveis alternativas que o Railway pode usar
  databaseUrl = process.env.POSTGRES_URL || 
                process.env.DATABASE_URL || 
                process.env.RAILWAY_DATABASE_URL || 
                '';
}

console.log('🔍 Configurando banco de dados...');
console.log(`   DATABASE_URL: ${databaseUrl ? databaseUrl.replace(/:[^:@]+@/, ':****@') : 'não configurado'}`);
console.log(`   DATABASE_URL length: ${databaseUrl.length}`);
console.log(`   DATABASE_URL starts with: ${databaseUrl.substring(0, 20)}...\n`);

// Detectar tipo de banco pela URL
const isPostgreSQL = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');
const isSQLite = databaseUrl.startsWith('file:') || !databaseUrl || databaseUrl === '';

// Verificar conflito: schema PostgreSQL mas DATABASE_URL SQLite
const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
let schemaProvider = 'unknown';
try {
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  if (schemaContent.includes('provider = "postgresql"')) {
    schemaProvider = 'postgresql';
  } else if (schemaContent.includes('provider = "sqlite"')) {
    schemaProvider = 'sqlite';
  }
} catch (e) {
  // Ignorar erro de leitura
}

// Verificar conflitos e corrigir automaticamente ANTES de qualquer operação
let schemaChanged = false;

if (schemaProvider === 'postgresql' && !isPostgreSQL) {
  // Schema PostgreSQL mas URL SQLite - pode ser desenvolvimento local
  if (isSQLite) {
    console.log('⚠️  Schema está em PostgreSQL mas DATABASE_URL é SQLite.');
    console.log('   Alterando schema para SQLite (desenvolvimento local)...\n');
    try {
      let schemaContent = fs.readFileSync(schemaPath, 'utf8');
      schemaContent = schemaContent.replace(/provider = "postgresql"/g, 'provider = "sqlite"');
      fs.writeFileSync(schemaPath, schemaContent, 'utf8');
      console.log('✅ Schema alterado para SQLite!');
      schemaProvider = 'sqlite';
      schemaChanged = true;
    } catch (error) {
      console.error('❌ Erro ao alterar schema:', error.message);
      process.exit(1);
    }
  } else {
    // Caso Railway: schema PostgreSQL mas URL não é PostgreSQL
    console.error('\n❌ ERRO CRÍTICO: Conflito de Configuração!');
    console.error('   Schema está configurado para PostgreSQL');
    console.error(`   Mas DATABASE_URL está como: ${databaseUrl || '(vazio)'}`);
    console.error('\n🔧 SOLUÇÃO:');
    console.error('   1. No Railway, vá no SERVIÇO "crypto-sinais-automaticos"');
    console.error('   2. Vá em "Variables" (não Shared Variables)');
    console.error('   3. Adicione ou edite: DATABASE_URL = ${{Postgres.DATABASE_URL}}');
    console.error('   4. Faça redeploy\n');
    process.exit(1);
  }
}

// Se detectar PostgreSQL mas schema está em SQLite, alterar
if (isPostgreSQL && schemaProvider === 'sqlite') {
  console.log('🔄 Schema está em SQLite, alterando para PostgreSQL...\n');
  try {
    let schemaContent = fs.readFileSync(schemaPath, 'utf8');
    schemaContent = schemaContent.replace(/provider = "sqlite"/g, 'provider = "postgresql"');
    fs.writeFileSync(schemaPath, schemaContent, 'utf8');
    console.log('✅ Schema alterado para PostgreSQL!');
    schemaProvider = 'postgresql';
    schemaChanged = true;
  } catch (error) {
    console.error('❌ Erro ao alterar schema:', error.message);
    process.exit(1);
  }
}

// Sempre regenerar Prisma Client para garantir que está sincronizado com o schema
// (importante porque o prisma generate pode ter sido executado antes com schema errado)
console.log('🔄 Gerando Prisma Client (garantindo sincronização com schema)...\n');
try {
  execSync('npx prisma generate', { 
    stdio: 'inherit', 
    cwd: process.cwd(),
    env: { ...process.env }
  });
  console.log('✅ Prisma Client gerado!\n');
} catch (error) {
  console.error('❌ Erro ao gerar Prisma Client:', error.message);
  process.exit(1);
}

if (isPostgreSQL) {
  console.log('✅ Detectado: PostgreSQL');
  
  // Se for railway.internal, não tentar conectar durante o build (só funciona em runtime)
  if (databaseUrl.includes('railway.internal')) {
    console.log('⚠️  PostgreSQL com railway.internal detectado.');
    console.log('   Durante o build, railway.internal não está acessível.');
    console.log('   O schema será aplicado automaticamente quando o serviço iniciar.\n');
    console.log('✅ Continuando build... (schema será aplicado no startup via db-init.ts)\n');
    process.exit(0);
  }
  
  // Verificar se há migrações
  const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
  const hasMigrations = fs.existsSync(migrationsDir) && fs.readdirSync(migrationsDir).length > 0;
  
  if (hasMigrations) {
    console.log('🔄 Executando migrações...\n');
    try {
      execSync('npx prisma migrate deploy', { 
        stdio: 'inherit', 
        cwd: process.cwd(),
        env: { ...process.env }
      });
      console.log('\n✅ Migrações PostgreSQL concluídas!');
    } catch (error) {
      console.error('\n❌ Erro ao executar migrações PostgreSQL:', error.message);
      // Tentar db push como fallback (SEM --accept-data-loss para preservar dados)
      console.log('⚠️  Tentando db push como fallback (preservando dados)...\n');
      try {
        // NUNCA usar --accept-data-loss no PostgreSQL
        execSync('npx prisma db push', { 
          stdio: 'inherit', 
          cwd: process.cwd(),
          env: { ...process.env },
          timeout: 30000
        });
        console.log('\n✅ Schema aplicado com db push!');
        console.log('✅ DADOS PRESERVADOS!');
      } catch (pushError) {
        // Durante o build, pode não conseguir conectar
        const errorMsg = ((pushError.message || pushError.toString() || '') + ' ' + (pushError.stderr?.toString() || '')).toLowerCase();
        const isConnectionError = errorMsg.includes("can't reach database server") || 
                                  errorMsg.includes('p1001') ||
                                  errorMsg.includes('connection') ||
                                  errorMsg.includes('timeout') ||
                                  errorMsg.includes('railway.internal') ||
                                  errorMsg.includes('econnrefused');
        
        if (isConnectionError) {
          console.log('\n⚠️  Não foi possível conectar ao PostgreSQL durante o build.');
          console.log('   Isso é normal - postgres.railway.internal só funciona quando o serviço está rodando.');
          console.log('   O schema será aplicado automaticamente quando o serviço iniciar.\n');
          console.log('✅ Continuando build... (schema será aplicado no startup via db-init.ts)\n');
          process.exit(0);
        } else {
          console.error('\n❌ Erro ao fazer db push:', pushError.message);
          process.exit(1);
        }
      }
    }
  } else {
    console.log('⚠️  Nenhuma migração encontrada. Usando db push (SEM --accept-data-loss para preservar dados)...\n');
    try {
      // NUNCA usar --accept-data-loss no PostgreSQL - dados sempre persistem
      // Capturar stderr para detectar erros de conexão
      let stderrOutput = '';
      try {
        execSync('npx prisma db push', { 
          stdio: ['inherit', 'inherit', 'pipe'], 
          cwd: process.cwd(),
          env: { ...process.env },
          timeout: 10000 // 10 segundos timeout (rápido para não travar build)
        });
        console.log('\n✅ Schema PostgreSQL aplicado com db push!');
        console.log('✅ DADOS PRESERVADOS - PostgreSQL sempre mantém dados entre deploys!');
      } catch (execError) {
        // Capturar stderr se disponível
        if (execError.stderr) {
          stderrOutput = execError.stderr.toString();
        }
        throw execError;
      }
    } catch (pushError) {
      // Durante o build, pode não conseguir conectar (postgres.railway.internal só funciona em runtime)
      const errorMsg = ((pushError.message || pushError.toString() || '') + ' ' + (pushError.stderr?.toString() || '')).toLowerCase();
      const isConnectionError = errorMsg.includes("can't reach database server") || 
                                errorMsg.includes('p1001') ||
                                errorMsg.includes('connection') ||
                                errorMsg.includes('timeout') ||
                                errorMsg.includes('railway.internal') ||
                                errorMsg.includes('econnrefused');
      
      if (isConnectionError) {
        console.log('\n⚠️  Não foi possível conectar ao PostgreSQL durante o build.');
        console.log('   Isso é normal - postgres.railway.internal só funciona quando o serviço está rodando.');
        console.log('   O schema será aplicado automaticamente quando o serviço iniciar.\n');
        console.log('✅ Continuando build... (schema será aplicado no startup via db-init.ts)\n');
        // Não falhar o build - o setup será feito no startup
        process.exit(0);
      } else {
        console.error('\n❌ Erro ao fazer db push:', pushError.message || pushError);
        console.error('⚠️  Se o schema mudou, você pode precisar criar uma migração: npx prisma migrate dev');
        process.exit(1);
      }
    }
  }
} else if (isSQLite) {
  console.log('✅ Detectado: SQLite');
  
  const dbPath = databaseUrl.replace('file:', '') || './data/prod.db';
  const dbFile = path.resolve(process.cwd(), dbPath);
  const dbDir = path.dirname(dbFile);
  
  // Criar diretório se não existir
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`✅ Diretório ${dbDir} criado`);
  }
  
  // Verificar se o banco já existe
  if (fs.existsSync(dbFile)) {
    console.log('✅ Banco de dados SQLite já existe. Pulando db push para preservar dados.');
    console.log('   Se precisar atualizar o schema, use: npx prisma migrate dev\n');
    process.exit(0);
  }
  
  // Banco não existe, criar com db push
  console.log('⚠️  Banco de dados SQLite não existe. Criando...\n');
  try {
    execSync('npx prisma db push', { 
      stdio: 'inherit', 
      cwd: process.cwd(),
      env: { ...process.env }
    });
    console.log('\n✅ Banco de dados SQLite criado com sucesso!');
  } catch (error) {
    console.error('\n❌ Erro ao criar banco SQLite:', error.message);
    process.exit(1);
  }
} else {
  console.error('❌ DATABASE_URL não reconhecido ou não configurado!');
  console.error(`   Valor recebido: ${databaseUrl || '(vazio)'}`);
  console.error('   Deve ser:');
  console.error('   - PostgreSQL: postgresql://... ou postgres://...');
  console.error('   - SQLite: file:./path/to/db.db');
  console.error('\n⚠️  PROBLEMA: A variável DATABASE_URL não está configurada corretamente no Railway!');
  console.error('   Verifique:');
  console.error('   1. Se PostgreSQL está Online');
  console.error('   2. Se DATABASE_URL está no SERVIÇO (não apenas Shared Variables)');
  console.error('   3. Se DATABASE_URL = ${{Postgres.DATABASE_URL}}');
  process.exit(1);
}

