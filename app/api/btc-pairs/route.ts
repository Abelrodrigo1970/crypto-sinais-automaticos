import { NextRequest, NextResponse } from 'next/server';
import { getBtcPairs } from '@/lib/btcPairs';

export const dynamic = 'force-dynamic';

/** Pares moeda/BTC de todos os perpétuos USDT cripto da Bybit (rácio sintético). `?refresh=1` ignora a cache. */
export async function GET(request: NextRequest) {
  try {
    const data = await getBtcPairs(request.nextUrl.searchParams.get('refresh') === '1');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao calcular pares BTC:', error);
    return NextResponse.json(
      { error: 'Erro ao calcular os pares BTC', details: error instanceof Error ? error.message : undefined },
      { status: 502 }
    );
  }
}
