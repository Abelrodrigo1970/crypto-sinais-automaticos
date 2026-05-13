import { NextRequest, NextResponse } from 'next/server';
import { runUniverseScanByCode } from '@/lib/runUniverseScanByCode';

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

    const result = await runUniverseScanByCode(code);
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          hint: result.hint,
          details: result.details,
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      universe: result.universe,
      universeSource: result.universeSource,
      persisted: result.persisted,
      persistedRunId: result.persistedRunId,
      persistError: result.persistError,
      note: result.note,
      count: result.count,
      rows: result.rows,
      scannedAt: result.scannedAt,
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
