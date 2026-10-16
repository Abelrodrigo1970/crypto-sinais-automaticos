import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getWallet } from '@/lib/bybitClient';
import { getTradingSwitch, setTradingSwitch, tradingConfig } from '@/lib/bybitTrading';

export const dynamic = 'force-dynamic';

/** Estado da execução Bybit: configuração, interruptor global, saldo e posições abertas */
export async function GET() {
  const cfg = tradingConfig();
  let wallet: { totalEquity: number; totalAvailableBalance: number } | null = null;
  let walletError: string | null = null;
  if (cfg.hasCredentials) {
    try {
      wallet = await getWallet();
    } catch (error) {
      walletError = error instanceof Error ? error.message : String(error);
    }
  }
  const [switchOn, openPositions, pendingExits] = await Promise.all([
    getTradingSwitch(),
    prisma.signal.count({ where: { execStatus: { in: ['FILLED', 'PARTIAL'] } } }),
    prisma.signal.count({ where: { execStatus: { in: ['EXIT_FAILED', 'EXIT_PARTIAL'] } } }),
  ]);
  return NextResponse.json({ ...cfg, switchOn, wallet, walletError, openPositions, pendingExits });
}

export async function PUT(request: NextRequest) {
  const { bybitTradingOn } = await request.json();
  if (typeof bybitTradingOn !== 'boolean') {
    return NextResponse.json({ error: 'bybitTradingOn tem de ser true ou false' }, { status: 400 });
  }
  return NextResponse.json({ switchOn: await setTradingSwitch(bybitTradingOn) });
}
