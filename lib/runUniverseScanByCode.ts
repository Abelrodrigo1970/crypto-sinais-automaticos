import { prisma } from './db';
import { scanSymbolUniverse, type UniverseScanRow } from './universeScanner';
import {
  getBuiltinScanDefinition,
  BUILTIN_UNIVERSE_META,
} from './symbolUniverseDefaults';
import { canQuerySymbolUniverseTable } from './strategyQueries';
import { persistUniverseScan } from './universeScanPersistence';

export type UniverseScanMeta = { code: string; displayName: string; description: string };

export type RunUniverseScanByCodeResult =
  | {
      ok: true;
      code: string;
      universe: UniverseScanMeta;
      universeSource: 'database' | 'built-in';
      persisted: boolean;
      persistedRunId?: string;
      persistError?: string;
      note?: string;
      count: number;
      rows: UniverseScanRow[];
      scannedAt: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      hint?: string;
      details?: string;
    };

/**
 * Resolve regras (BD ou embutido), corre `scanSymbolUniverse` e grava histórico.
 * Usado pela API `/api/symbol-universes/scan` e pelo cron Scanner 3.
 */
export async function runUniverseScanByCode(code: string): Promise<RunUniverseScanByCodeResult> {
  let scanDef = getBuiltinScanDefinition(code);
  let meta = BUILTIN_UNIVERSE_META[code];
  let source: 'database' | 'built-in' = 'built-in';

  if (scanDef && (await canQuerySymbolUniverseTable())) {
    try {
      const universe = await prisma.symbolUniverse.findUnique({
        where: { code },
      });
      if (universe) {
        source = 'database';
        scanDef = {
          ruleType: universe.ruleType,
          maPeriod: universe.maPeriod,
          maxDistancePct: universe.maxDistancePct,
          timeframe: universe.timeframe,
          minQuoteVolume: universe.minQuoteVolume,
          candidateLimit: universe.candidateLimit,
        };
        meta = {
          code: universe.code,
          displayName: universe.displayName,
          description: universe.description,
        };
      }
    } catch {
      // mantém built-in
    }
  }

  if (!scanDef || !meta) {
    return {
      ok: false,
      status: 404,
      error: `Código de universo desconhecido: ${code}`,
      hint:
        'Usa UNIVERSE_ABOVE_MA200_1H, UNIVERSE_NEAR_MA200_PCT10_1H ou UNIVERSE_NEAR_MA200_PCT4_1H.',
    };
  }

  try {
    const rows = await scanSymbolUniverse(scanDef);
    const scannedAt = new Date().toISOString();

    const persisted = await persistUniverseScan({
      universeCode: code,
      source,
      rows,
    });

    return {
      ok: true,
      code,
      universe: meta,
      universeSource: source,
      persisted: persisted.ok,
      persistedRunId: persisted.ok ? persisted.runId : undefined,
      persistError: persisted.ok ? undefined : persisted.reason,
      note:
        source === 'built-in'
          ? 'Scan com regras embutidas (BD sem SymbolUniverse ou sem registo). Para ligar estratégias ao universo na BD, corre prisma db push + seed.'
          : undefined,
      count: rows.length,
      rows,
      scannedAt,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return {
      ok: false,
      status: 500,
      error: 'Erro ao executar scan',
      details: msg,
      hint:
        msg.includes('does not exist') || msg.includes('SymbolUniverse')
          ? 'Schema em falta na BD: `npx prisma db push`'
          : undefined,
    };
  }
}
