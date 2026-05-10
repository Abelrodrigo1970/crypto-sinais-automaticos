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

    const universe = await prisma.symbolUniverse.findUnique({
      where: { code },
    });

    if (!universe) {
      return NextResponse.json({ error: `Universo não encontrado: ${code}` }, { status: 404 });
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
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao executar scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
