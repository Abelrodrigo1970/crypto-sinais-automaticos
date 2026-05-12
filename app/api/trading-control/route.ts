import { NextRequest, NextResponse } from 'next/server';
import { getTradingControl, setBinanceExecutionOn } from '@/lib/tradingControl';

export const dynamic = 'force-dynamic';

/** Estado do interruptor Binance (página Estratégias). */
export async function GET() {
  try {
    const { binanceExecutionOn } = await getTradingControl();
    return NextResponse.json({ binanceExecutionOn });
  } catch (error) {
    console.error('Erro GET trading-control:', error);
    return NextResponse.json(
      { error: 'Erro ao ler controlo', binanceExecutionOn: true },
      { status: 500 }
    );
  }
}

/** Body: { "binanceExecutionOn": true | false } */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = body?.binanceExecutionOn;
    if (typeof raw !== 'boolean') {
      return NextResponse.json(
        { error: 'binanceExecutionOn (boolean) é obrigatório' },
        { status: 400 }
      );
    }
    const { binanceExecutionOn } = await setBinanceExecutionOn(raw);
    return NextResponse.json({ ok: true, binanceExecutionOn });
  } catch (error) {
    console.error('Erro PUT trading-control:', error);
    return NextResponse.json(
      { error: 'Erro ao gravar controlo' },
      { status: 500 }
    );
  }
}
