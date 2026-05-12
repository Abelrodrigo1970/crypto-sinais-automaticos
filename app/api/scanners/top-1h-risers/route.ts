import { NextRequest, NextResponse } from 'next/server';
import { fetchTopSymbolsBy1hPriceChangeDetailed } from '@/lib/marketData';

/**
 * Scanner: top pares USDT perpetual a subir na última hora (velas 1h).
 * Query: limit (1–100, defeito 50), candidatePool (50–500, defeito 400), onlyRising (true|false).
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const limitRaw = parseInt(sp.get('limit') || '50', 10);
    const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));

    const poolRaw = parseInt(sp.get('candidatePool') || '400', 10);
    const candidatePool = Math.min(500, Math.max(50, Number.isFinite(poolRaw) ? poolRaw : 400));

    const onlyRising = sp.get('onlyRising') !== 'false';

    const rows = await fetchTopSymbolsBy1hPriceChangeDetailed(limit, candidatePool, onlyRising);

    return NextResponse.json({
      success: true,
      rows,
      count: rows.length,
      limit,
      candidatePool,
      onlyRising,
      fetchedAt: new Date().toISOString(),
      note:
        'Ranking entre os primeiros candidatePool perpetuals USDT no exchangeInfo da Binance; em cada um compara-se o fecho da última vela 1h fechada com a anterior. Com onlyRising=true (defeito), só entram pares com variação > 0%.',
    });
  } catch (error) {
    console.error('Erro no scanner top 1h risers:', error);
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
