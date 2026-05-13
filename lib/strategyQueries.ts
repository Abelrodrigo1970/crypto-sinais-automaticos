/**
 * Leitura de Strategy compatível com BD antiga (sem SymbolUniverse / symbolUniverseId).
 * O motor de sinais e a API devem usar isto em vez de prisma.strategy.findMany + include,
 * senão o Prisma gera SQL com colunas que ainda não existem (P2022).
 */

import { prisma } from './db';

function isPostgresUrl(): boolean {
  const u = process.env.DATABASE_URL || '';
  return u.startsWith('postgresql://') || u.startsWith('postgres://');
}

/**
 * Só usar prisma.strategy.findMany + include se coluna e tabela existirem.
 * Evita P2022/P2021 e logs "Invalid findMany" no runtime.
 */
/** Evita `prisma.symbolUniverse.*` quando a tabela não existe (sem logs P2021). */
export async function canQuerySymbolUniverseTable(): Promise<boolean> {
  try {
    if (isPostgresUrl()) {
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "SymbolUniverse" LIMIT 1`);
    } else {
      await prisma.$queryRawUnsafe(`SELECT 1 FROM SymbolUniverse LIMIT 1`);
    }
    return true;
  } catch {
    return false;
  }
}

async function canUseOrmStrategyWithUniverse(): Promise<boolean> {
  try {
    if (isPostgresUrl()) {
      await prisma.$queryRawUnsafe(`SELECT "symbolUniverseId" FROM "Strategy" LIMIT 1`);
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "SymbolUniverse" LIMIT 1`);
      return true;
    }
    await prisma.$queryRawUnsafe(`SELECT symbolUniverseId FROM Strategy LIMIT 1`);
    await prisma.$queryRawUnsafe(`SELECT 1 FROM SymbolUniverse LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

async function loadStrategiesRawSql(activeOnly: boolean): Promise<StrategyWithUniverseRow[]> {
  const dbUrl = process.env.DATABASE_URL || '';

  if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
    const filter = activeOnly ? ` WHERE "isActive" = true` : '';
    const sql = `SELECT id, name, "displayName", description, "isActive", COALESCE("binanceExecutionOn", true) AS "binanceExecutionOn", params, "createdAt", "updatedAt" FROM "Strategy"${filter} ORDER BY name ASC`;
    try {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          displayName: string;
          description: string;
          isActive: boolean;
          binanceExecutionOn: boolean;
          params: string;
          createdAt: Date;
          updatedAt: Date;
        }>
      >(sql);
      return rows.map(
        (r): StrategyWithUniverseRow => ({
          ...r,
          binanceExecutionOn: r.binanceExecutionOn !== false,
          symbolUniverseId: null,
          symbolUniverse: null,
        })
      );
    } catch (e) {
      const filterLoose = activeOnly ? ` WHERE isActive = true` : '';
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          displayName: string;
          description: string;
          isActive: boolean;
          binanceExecutionOn: boolean;
          params: string;
          createdAt: Date;
          updatedAt: Date;
        }>
      >(
        `SELECT id, name, displayName, description, isActive, COALESCE(binanceExecutionOn, 1) AS binanceExecutionOn, params, createdAt, updatedAt FROM strategy${filterLoose} ORDER BY name ASC`
      );
      return rows.map(
        (r): StrategyWithUniverseRow => ({
          ...r,
          binanceExecutionOn: Boolean(r.binanceExecutionOn),
          symbolUniverseId: null,
          symbolUniverse: null,
        })
      );
    }
  }

  const filter = activeOnly ? ` WHERE isActive = 1` : '';
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      name: string;
      displayName: string;
      description: string;
      isActive: boolean;
      binanceExecutionOn: number | boolean;
      params: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  >(
    `SELECT id, name, displayName, description, isActive, COALESCE(binanceExecutionOn, 1) AS binanceExecutionOn, params, createdAt, updatedAt FROM Strategy${filter} ORDER BY name ASC`
  );
  return rows.map(
    (r): StrategyWithUniverseRow => ({
      ...r,
      binanceExecutionOn: Boolean(r.binanceExecutionOn),
      symbolUniverseId: null,
      symbolUniverse: null,
    })
  );
}

/** Campos de SymbolUniverse usados pelo motor de sinais */
export type SymbolUniverseForRun = {
  id: string;
  code: string;
  displayName: string;
  description: string;
  ruleType: string;
  maPeriod: number;
  maxDistancePct: number | null;
  timeframe: string;
  minQuoteVolume: number;
  candidateLimit: number;
};

export type StrategyWithUniverseRow = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  binanceExecutionOn: boolean;
  params: string;
  createdAt: Date;
  updatedAt: Date;
  symbolUniverseId: string | null;
  symbolUniverse: SymbolUniverseForRun | null;
};

export async function findStrategiesWithUniverseFallback(options?: {
  /** Só estratégias ativas (ex.: runAllStrategies) */
  activeOnly?: boolean;
}): Promise<StrategyWithUniverseRow[]> {
  const activeOnly = options?.activeOnly === true;
  const where = activeOnly ? { isActive: true as const } : {};

  const ormOk = await canUseOrmStrategyWithUniverse();
  if (!ormOk) {
    console.warn(
      '[strategyQueries] Schema sem SymbolUniverse / symbolUniverseId — a usar SELECT legado (corre `npx prisma db push` na BD).'
    );
    return loadStrategiesRawSql(activeOnly);
  }

  try {
    return (await prisma.strategy.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { symbolUniverse: true },
    })) as StrategyWithUniverseRow[];
  } catch (err) {
    console.warn(
      '[strategyQueries] findMany falhou — fallback SQL:',
      err instanceof Error ? err.message : err
    );
    return loadStrategiesRawSql(activeOnly);
  }
}
