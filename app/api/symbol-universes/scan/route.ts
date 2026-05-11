import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { scanSymbolUniverse } from '@/lib/universeScanner';
import {
  getBuiltinScanDefinition,
  BUILTIN_UNIVERSE_META,
} from '@/lib/symbolUniverseDefaults';
import { canQuerySymbolUniverseTable } from '@/lib/strategyQueries';
import { persistUniverseScan } from '@/lib/universeScanPersistence';

/**
 * GET ?code=UNIVERSE_ABOVE_MA200_1H — executa o scan e devolve linhas (pode demorar).
 * Funciona sem tabela SymbolUniverse (usa definições embutidas).
 */
export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) {
      return NextResponse.json({ error: 'Parâmetro code obrigatório' }, { status: 400 });
    }

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
        // Drift entre probe e ORM (ex. deploy antigo / schema a meio) — mantém regras embutidas
      }
    }

    if (!scanDef || !meta) {
      return NextResponse.json(
        {
          error: `Código de universo desconhecido: ${code}`,
          hint: 'Usa UNIVERSE_ABOVE_MA200_1H ou UNIVERSE_NEAR_MA200_PCT10_1H.',
        },
        { status: 404 }
      );
    }

    const rows = await scanSymbolUniverse(scanDef);
    const scannedAt = new Date().toISOString();

    const persisted = await persistUniverseScan({
      universeCode: code,
      source,
      rows,
    });

    return NextResponse.json({
      success: true,
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
    });
  } catch (error) {
    console.error('Erro no scan de universo:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao executar scan',
        details: msg,
        hint:
          msg.includes('does not exist') || msg.includes('SymbolUniverse')
            ? 'Schema em falta na BD: `npx prisma db push`'
            : undefined,
      },
      { status: 500 }
    );
  }
}
