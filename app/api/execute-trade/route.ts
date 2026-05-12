import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { executeSignalReal, getExecutorStatus } from '@/lib/tradingExecutor';
import { getTradingControl } from '@/lib/tradingControl';

export const dynamic = 'force-dynamic';

/**
 * GET: Retorna status do executor (se pode executar trades).
 */
export async function GET() {
  try {
    const status = getExecutorStatus();
    const { binanceExecutionOn } = await getTradingControl();
    const canExecute = status.ready && binanceExecutionOn;
    const reason = canExecute
      ? undefined
      : !binanceExecutionOn
        ? 'Binance em pausa (página Estratégias — interruptor OFF).'
        : status.reason;
    return NextResponse.json({
      tradingEnabled: status.tradingEnabled,
      hasCredentials: status.hasCredentials,
      isTestnet: status.isTestnet,
      mainnetTradingEnabled: status.mainnetTradingEnabled,
      mainnetStrategyAllowlist: status.mainnetStrategyAllowlist,
      binanceExecutionOn,
      binancePaused: !binanceExecutionOn,
      canExecute,
      reason,
    });
  } catch (error) {
    console.error('Erro execute-trade GET:', error);
    return NextResponse.json(
      { error: 'Erro ao verificar status' },
      { status: 500 }
    );
  }
}

/**
 * POST: Executa trade para um sinal.
 * Body: { signalId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const signalId = body?.signalId;

    if (!signalId || typeof signalId !== 'string') {
      return NextResponse.json(
        { error: 'signalId é obrigatório' },
        { status: 400 }
      );
    }

    const signal = await prisma.signal.findUnique({
      where: { id: signalId },
      select: {
        id: true,
        symbol: true,
        direction: true,
        entryPrice: true,
        stopLoss: true,
        target1: true,
        target2: true,
        target3: true,
        strength: true,
        strategyName: true,
        status: true,
      },
    });

    if (!signal) {
      return NextResponse.json({ error: 'Sinal não encontrado' }, { status: 404 });
    }

    if (signal.status === 'IN_PROGRESS') {
      return NextResponse.json(
        { success: false, error: 'Sinal já executado' },
        { status: 400 }
      );
    }

    const result = await executeSignalReal({
      id: signal.id,
      symbol: signal.symbol,
      direction: signal.direction as 'BUY' | 'SELL',
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      target1: signal.target1,
      target2: signal.target2,
      target3: signal.target3,
      strength: signal.strength,
      strategyName: signal.strategyName,
      status: signal.status,
    });

    if (result.success && result.orderId) {
      // Raw update to avoid Prisma selecting columns (executedAt, executionOrderId) that may not exist in DB
      await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${signalId}`;
      return NextResponse.json({
        success: true,
        message: result.message,
        orderId: result.orderId,
        stopOrderId: result.stopOrderId,
      });
    }

    return NextResponse.json(
      { success: false, error: result.message },
      { status: 400 }
    );
  } catch (error) {
    console.error('Erro execute-trade POST:', error);
    const msg = error instanceof Error ? error.message : 'Erro ao executar trade';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
