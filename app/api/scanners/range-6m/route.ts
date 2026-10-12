import { NextRequest, NextResponse } from 'next/server';
import { fetchTopRange6m, RANGE_6M_DEFAULT_MIN_QUOTE_VOLUME } from '@/lib/range6mScanner';

export const dynamic = 'force-dynamic';

/**
 * Scanner: top perpétuos USDT com maior amplitude máx/mín nos últimos 6 meses (velas 1d).
 * Query: limit (1–100, defeito 30), minVolume (USDT 24h, defeito 1M).
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const limitRaw = parseInt(sp.get('limit') || '30', 10);
    const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 30));

    const volRaw = parseFloat(sp.get('minVolume') || String(RANGE_6M_DEFAULT_MIN_QUOTE_VOLUME));
    const minVolume = Number.isFinite(volRaw) && volRaw >= 0 ? volRaw : RANGE_6M_DEFAULT_MIN_QUOTE_VOLUME;

    const result = await fetchTopRange6m(limit, minVolume);

    return NextResponse.json({
      success: true,
      ...result,
      count: result.rows.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro no scanner amplitude 6 meses:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao calcular o scanner',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
