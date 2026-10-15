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
  const databaseUrl = process.env.DATABASE_URL || '';
  const isPostgreSQL = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');

  try {
    if (!isPostgreSQL) {
      // SQLite (desenvolvimento local): criar ficheiro se não existir
      const dbPath = databaseUrl.replace('file:', '') || './data/prod.db';
      const dbFile = path.resolve(process.cwd(), dbPath);
      if (!fs.existsSync(dbFile)) {
        fs.mkdirSync(path.dirname(dbFile), { recursive: true });
        console.log('⚠️ Banco de dados SQLite não existe. A criar...');
        execSync('npx prisma db push', { stdio: 'pipe', cwd: process.cwd() });
      }
    }

    await prisma.$connect();
    try {
      await prisma.strategy.count();
    } catch {
      // NUNCA usar --accept-data-loss: só cria o que falta
      console.log('⚠️  Tabelas não existem. Aplicando schema (db push)...');
      execSync('npx prisma db push', { stdio: 'pipe', cwd: process.cwd(), env: { ...process.env } });
      console.log('✅ Schema aplicado!');
    }

    dbInitialized = true;
    console.log('✅ Banco de dados conectado e pronto');
    return true;
  } catch (error: any) {
    console.error('❌ Erro na inicialização do banco:', error.message);
    return false;
  }
}

// Inicializar em background (não bloqueia)
if (typeof window === 'undefined') {
  ensureDatabase().catch(console.error);
}
