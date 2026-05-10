/**
 * Inicialização do banco de dados no startup da aplicação
 * Roda automaticamente quando o módulo é importado
 * Usa import dinâmico para evitar dependência circular com db.ts
 */

async function getPrisma() {
  const { prisma } = await import('./db');
  return prisma;
}
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

let dbInitialized = false;

export async function ensureDatabase() {
  if (dbInitialized) {
    return true;
  }

  const prisma = await getPrisma();

  try {
    const databaseUrl = process.env.DATABASE_URL || '';
    const isPostgreSQL = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');
    const isSQLite = databaseUrl.startsWith('file:') || !databaseUrl || databaseUrl === '';

    if (isPostgreSQL) {
      console.log('🔄 Inicializando PostgreSQL no startup...');
      
      try {
        // Tentar conectar primeiro
        await prisma.$connect();
        
        // Verificar se as tabelas existem tentando contar estratégias
        try {
          await prisma.strategy.count();
          // Schema antigo: Strategy existe mas faltam tabelas novas (ex. SymbolUniverse)
          try {
            await prisma.symbolUniverse.count();
          } catch {
            console.log('⚠️  Tabela SymbolUniverse em falta. Aplicando schema (db push)...');
            execSync('npx prisma db push', {
              stdio: 'pipe',
              cwd: process.cwd(),
              env: { ...process.env },
            });
            console.log('✅ Schema atualizado (SymbolUniverse).');
            try {
              execSync('npx tsx prisma/seed.ts', { stdio: 'pipe', cwd: process.cwd() });
              console.log('✅ Seed executado (universos / estratégias).');
            } catch {
              console.log('⚠️  Seed opcional falhou (normal se prisma/seed ignorado no deploy).');
            }
          }
          // FK/coluna nova em Strategy sem db push completo
          try {
            await prisma.$queryRawUnsafe(`SELECT "symbolUniverseId" FROM "Strategy" LIMIT 1`);
          } catch {
            console.log('⚠️  Coluna Strategy.symbolUniverseId em falta. Aplicando schema (db push)...');
            execSync('npx prisma db push', {
              stdio: 'pipe',
              cwd: process.cwd(),
              env: { ...process.env },
            });
            try {
              execSync('npx tsx prisma/seed.ts', { stdio: 'pipe', cwd: process.cwd() });
            } catch {
              /* opcional */
            }
          }
          console.log('✅ PostgreSQL conectado e tabelas existem');
          dbInitialized = true;
          return true;
        } catch (e: any) {
          // Tabelas não existem, criar schema
          console.log('⚠️  Tabelas não existem. Aplicando schema...');
          // NUNCA usar --accept-data-loss no PostgreSQL - dados sempre persistem
          execSync('npx prisma db push', { 
            stdio: 'pipe', 
            cwd: process.cwd(),
            env: { ...process.env }
          });
          console.log('✅ Schema aplicado!');
          console.log('✅ DADOS PRESERVADOS - PostgreSQL sempre mantém dados!');
          
          // Popular estratégias
          try {
            execSync('npx tsx prisma/seed.ts', { stdio: 'pipe', cwd: process.cwd() });
            console.log('✅ Estratégias populadas');
          } catch (seedError) {
            console.log('⚠️  Seed pode ter falhado (normal se já existir)');
          }
          
          dbInitialized = true;
          return true;
        }
      } catch (error: any) {
        console.error('❌ Erro ao conectar/incializar PostgreSQL:', error.message);
        // Não falha completamente, tenta novamente depois
        return false;
      }
    } else if (isSQLite) {
      // Código original para SQLite
      const dbPath = databaseUrl.replace('file:', '') || './data/prod.db';
      const dbDir = path.dirname(dbPath);
      const dbFile = path.resolve(process.cwd(), dbPath);

      // Criar diretório se não existir
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log(`✅ Diretório ${dbDir} criado`);
      }

      // Verificar se o banco existe
      if (!fs.existsSync(dbFile)) {
        console.log('⚠️ Banco de dados não existe. Tentando criar...');
        
        try {
          // Gerar Prisma Client se necessário
          execSync('npx prisma generate', { stdio: 'pipe', cwd: process.cwd() });
          
          // Criar banco e tabelas
          execSync('npx prisma db push --accept-data-loss', { stdio: 'pipe', cwd: process.cwd() });
          
          // Popular estratégias
          try {
            execSync('npx tsx prisma/seed.ts', { stdio: 'pipe', cwd: process.cwd() });
          } catch (e) {
            // Ignora erro do seed se já existir
          }
          
          console.log('✅ Banco de dados criado com sucesso!');
        } catch (error: any) {
          console.error('❌ Erro ao criar banco:', error.message);
          // Não falha, apenas loga
        }
      }

      // Testar conexão
      try {
        await prisma.$connect();
        await prisma.strategy.count();
        try {
          await prisma.symbolUniverse.count();
        } catch {
          console.log('⚠️  SQLite: SymbolUniverse em falta. Aplicando db push...');
          execSync('npx prisma db push', {
            stdio: 'pipe',
            cwd: process.cwd(),
            env: { ...process.env },
          });
        }
        try {
          await prisma.$queryRawUnsafe(`SELECT symbolUniverseId FROM Strategy LIMIT 1`);
        } catch {
          console.log('⚠️  SQLite: coluna symbolUniverseId em falta. Aplicando db push...');
          execSync('npx prisma db push', {
            stdio: 'pipe',
            cwd: process.cwd(),
            env: { ...process.env },
          });
        }
        dbInitialized = true;
        console.log('✅ Banco de dados conectado e pronto');
        return true;
      } catch (error: any) {
        console.error('❌ Erro ao conectar ao banco:', error.message);
        return false;
      }
    } else {
      console.error('❌ DATABASE_URL não reconhecido');
      return false;
    }
  } catch (error: any) {
    console.error('❌ Erro na inicialização do banco:', error.message);
    return false;
  }
}

// Inicializar em background (não bloqueia)
if (typeof window === 'undefined') {
  ensureDatabase().catch(console.error);
}




