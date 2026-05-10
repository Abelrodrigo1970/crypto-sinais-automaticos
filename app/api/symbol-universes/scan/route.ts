import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { scanSymbolUniverse } from '@/lib/universeScanner';

/**
 * GET ?code=UNIVERSE_ABOVE_MA200_1H — executa o scan e devolve linhas (pode demorar).
 */
export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) {
      return NextResponse.json({ error: 'Parâmetro code obrigatório' }, { status: 400 });
    }

    let universe;
    try {
      universe = await prisma.symbolUniverse.findUnique({
        where: { code },
      });
    } catch (dbErr) {
      console.error('symbolUniverse.findUnique:', dbErr);
      return NextResponse.json(
        {
          success: false,
          error: 'Base de dados sem tabela SymbolUniverse',
          details: dbErr instanceof Error ? dbErr.message : undefined,
          hint: 'Corre `npx prisma db push` no servidor e `npx tsx prisma/seed.ts` (ou insere os 2 universos manualmente).',
        },
        { status: 503 }
      );
    }

    if (!universe) {
      return NextResponse.json(
        {
          error: `Universo não encontrado: ${code}`,
          hint: 'Sem registo na BD — corre o seed ou cria SymbolUniverse com este code.',
        },
        { status: 404 }
      );
    }

    const rows = await scanSymbolUniverse({
      ruleType: universe.ruleType,
      maPeriod: universe.maPeriod,
      maxDistancePct: universe.maxDistancePct,
      timeframe: universe.timeframe,
      minQuoteVolume: universe.minQuoteVolume,
      candidateLimit: universe.candidateLimit,
    });

    return NextResponse.json({
      success: true,
      universe: {
        code: universe.code,
        displayName: universe.displayName,
        description: universe.description,
      },
      count: rows.length,
      rows,
      scannedAt: new Date().toISOString(),
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
