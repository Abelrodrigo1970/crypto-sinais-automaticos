import { NextRequest, NextResponse } from 'next/server';
import { ensureWeeklyBtcSnapshots } from '@/lib/btcPairsHistory';

export const dynamic = 'force-dynamic';

/**
 * Cria as listas semanais dos pares BTC em falta (segundas-feiras 01:00 de Lisboa, desde 1 de setembro).
 * Corre em background; o cron de hora a hora (run-signals) também o chama.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  void ensureWeeklyBtcSnapshots().catch((e) => console.error('[Pares BTC] erro nas listas semanais:', e));
  return NextResponse.json({ success: true, message: 'Listas semanais em atualização (background)' });
}
