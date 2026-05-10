import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { listBuiltinUniversesForApi } from '@/lib/symbolUniverseDefaults';
import { canQuerySymbolUniverseTable } from '@/lib/strategyQueries';

/** Lista universos de símbolos (Scanner 1 / 2) para UI e estratégias */
export async function GET() {
  try {
    if (!(await canQuerySymbolUniverseTable())) {
      return NextResponse.json({
        universes: listBuiltinUniversesForApi(),
        warning:
          'Tabela SymbolUniverse inexistente: o scan em /scanners/universos funciona; corre `npx prisma db push` e o seed para gravar na BD.',
      });
    }

    const universes = await prisma.symbolUniverse.findMany({
      orderBy: { code: 'asc' },
    });
    if (universes.length > 0) {
      return NextResponse.json({ universes });
    }
    return NextResponse.json({
      universes: listBuiltinUniversesForApi(),
      warning:
        'Tabela SymbolUniverse vazia — o scan em /scanners/universos funciona; corre `npx tsx prisma/seed.ts` (ou db push + seed) para gravar universos e associar estratégias.',
    });
  } catch (error) {
    console.error('Erro ao listar universos:', error);
    return NextResponse.json({
      universes: listBuiltinUniversesForApi(),
      warning:
        'Tabela SymbolUniverse inexistente: o scan em /scanners/universos funciona; para o dropdown de estratégias gravar na BD, corre `npx prisma db push` e o seed.',
      details: error instanceof Error ? error.message : undefined,
    });
  }
}
