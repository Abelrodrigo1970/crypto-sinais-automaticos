/**
 * Singleton do Prisma Client para evitar múltiplas instâncias
 */

import { PrismaClient } from '@prisma/client';

/**
 * Scripts como `scripts/scan-signals.ts` definem SKIP_DB_INIT=1 antes de importar módulos que usam Prisma,
 * para não correr db-init (criar SQLite / prisma generate). No Windows isso evita EPERM ao renomear query_engine DLL.
 */
if (process.env.SKIP_DB_INIT !== '1') {
  void import('./db-init');
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

