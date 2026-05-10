/**
 * Leitura de Strategy compatível com BD antiga (sem SymbolUniverse / symbolUniverseId).
 */

import { prisma } from './db';

export async function findStrategiesWithUniverseFallback(): Promise<
  Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
    isActive: boolean;
    params: string;
    createdAt: Date;
    updatedAt: Date;
    symbolUniverseId: string | null;
    symbolUniverse: null;
  }>
> {
  try {
    return (await prisma.strategy.findMany({
      orderBy: { name: 'asc' },
      include: { symbolUniverse: true },
    })) as any;
  } catch (err) {
    console.warn(
      '[strategyQueries] findMany com symbolUniverse falhou — a usar SELECT legado (corre prisma db push na BD):',
      err instanceof Error ? err.message : err
    );

    const dbUrl = process.env.DATABASE_URL || '';

    if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          displayName: string;
          description: string;
          isActive: boolean;
          params: string;
          createdAt: Date;
          updatedAt: Date;
        }>
      >(
        `SELECT id, name, "displayName", description, "isActive", params, "createdAt", "updatedAt" FROM "Strategy" ORDER BY name ASC`
      );
      return rows.map((r) => ({
        ...r,
        symbolUniverseId: null,
        symbolUniverse: null,
      }));
    }

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        displayName: string;
        description: string;
        isActive: boolean;
        params: string;
        createdAt: Date;
        updatedAt: Date;
      }>
    >(
      `SELECT id, name, displayName, description, isActive, params, createdAt, updatedAt FROM Strategy ORDER BY name ASC`
    );
    return rows.map((r) => ({
      ...r,
      symbolUniverseId: null,
      symbolUniverse: null,
    }));
  }
}
