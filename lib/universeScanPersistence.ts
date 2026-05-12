import { prisma } from './db';

/** Mantém no máximo N execuções por código de universo (evita crescimento infinito). */
const SCAN_HISTORY_KEEP = 25;

export type PersistUniverseScanInput = {
  universeCode: string;
  source: string;
  rows: Array<{ symbol: string; close: number; ma: number; pctFromMa: number }>;
};

export type PersistUniverseScanResult =
  | { ok: true; runId: string }
  | { ok: false; reason: string };

/**
 * Grava o resultado de um scan MA200 na BD (histórico por `universeCode`).
 * Falha em silêncio com `ok: false` se a tabela ainda não existir (deploy antigo).
 */
export async function persistUniverseScan(
  input: PersistUniverseScanInput
): Promise<PersistUniverseScanResult> {
  try {
    const runId = await prisma.$transaction(async (tx) => {
      const run = await tx.universeScanRun.create({
        data: {
          universeCode: input.universeCode,
          rowCount: input.rows.length,
          source: input.source,
        },
      });

      if (input.rows.length > 0) {
        await tx.universeScanRow.createMany({
          data: input.rows.map((r) => ({
            runId: run.id,
            symbol: r.symbol,
            close: r.close,
            ma: r.ma,
            pctFromMa: r.pctFromMa,
          })),
        });
      }

      const oldRuns = await tx.universeScanRun.findMany({
        where: { universeCode: input.universeCode },
        orderBy: { scannedAt: 'desc' },
        select: { id: true },
        skip: SCAN_HISTORY_KEEP,
      });
      if (oldRuns.length > 0) {
        await tx.universeScanRun.deleteMany({
          where: { id: { in: oldRuns.map((r) => r.id) } },
        });
      }

      return run.id;
    });

    return { ok: true, runId };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[persistUniverseScan]', reason);
    return { ok: false, reason };
  }
}

export type LatestUniverseScanResult =
  | {
      ok: true;
      symbols: string[];
      runId: string;
      scannedAt: Date;
      rowCount: number;
    }
  | { ok: false; reason: string };

/** Último run gravado para um `universeCode` (ex.: resultado do Scanner 2 na página Universos). */
export async function getLatestUniverseScanSymbols(
  universeCode: string
): Promise<LatestUniverseScanResult> {
  try {
    const run = await prisma.universeScanRun.findFirst({
      where: { universeCode },
      orderBy: { scannedAt: 'desc' },
      select: {
        id: true,
        scannedAt: true,
        rowCount: true,
        rows: { select: { symbol: true } },
      },
    });
    if (!run) {
      return {
        ok: false,
        reason:
          'Nenhum scan gravado na BD. Execute o Scanner 2 em /scanners/universos (ou API de scan) primeiro.',
      };
    }
    const symbols = run.rows.map((r) => r.symbol);
    return {
      ok: true,
      symbols,
      runId: run.id,
      scannedAt: run.scannedAt,
      rowCount: run.rowCount,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[getLatestUniverseScanSymbols]', reason);
    return { ok: false, reason };
  }
}
