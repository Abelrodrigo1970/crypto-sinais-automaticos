import { NextResponse } from 'next/server';
import { fetchStockUniverse } from '@/lib/marketData';

export const dynamic = 'force-dynamic';

/** Ações + ETFs em negociação na Bybit, ordenados por volume 24h. */
export async function GET() {
  try {
    const assets = await fetchStockUniverse();
    return NextResponse.json({
      count: assets.length,
      stocks: assets.filter((a) => a.type === 'stock').length,
      etfs: assets.filter((a) => a.type === 'ETF').length,
      assets,
    });
  } catch (error) {
    console.error('Erro ao buscar universo Bybit:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar universo Bybit', details: error instanceof Error ? error.message : undefined },
      { status: 502 }
    );
  }
}
