import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { executeSignalReal, getExecutorStatus } from '@/lib/tradingExecutor';
import { getTradingControl } from '@/lib/tradingControl';
import { isDirectionEnabledForStrategy } from '@/lib/strategySideControls';

export const dynamic = 'force-dynamic';

/**
 * GET: status do executor. Query opcional `signalId` — inclui se a estratégia desse sinal permite Binance.
 */
export async function GET(request: NextRequest) {
  try {
    const status = getExecutorStatus();
    const { binanceExecutionOn } = await getTradingControl();

    const signalId = request.nextUrl.searchParams.get('signalId');
    let strategyBinanceOn = true;
    if (signalId) {
      try {
        const row = await prisma.signal.findUnique({
          where: { id: signalId },
          select: {
            direction: true,
            strategy: { select: { name: true, binanceExecutionOn: true, params: true } },
          },
        });
        strategyBinanceOn = row?.strategy?.binanceExecutionOn !== false;
        if (
          row?.strategy &&
          !isDirectionEnabledForStrategy(
            row.strategy.name,
            row.strategy.params,
            row.direction as 'BUY' | 'SELL'
          )
        ) {
          strategyBinanceOn = false;
        }
      } catch {
        strategyBinanceOn = true;
      }
    }

    const canExecute = status.ready && binanceExecutionOn && strategyBinanceOn;
    let reason: string | undefined;
    if (!canExecute) {
      if (!binanceExecutionOn) {
        reason = 'Binance em pausa (página Estratégias — interruptor global OFF).';
      } else if (!strategyBinanceOn && signalId) {
        const row = await prisma.signal.findUnique({
          where: { id: signalId },
          select: {
            direction: true,
            strategy: { select: { name: true, params: true } },
          },
        });
        if (
          row?.strategy &&
          !isDirectionEnabledForStrategy(
            row.strategy.name,
            row.strategy.params,
            row.direction as 'BUY' | 'SELL'
          )
        ) {
          reason =
            row.direction === 'BUY'
              ? 'Compra desativada para Afastamento médio 30m (Estratégias — interruptor Compra OFF).'
              : 'Venda desativada para Afastamento médio 30m (Estratégias — interruptor Venda OFF).';
        } else {
          reason =
            'Execução Binance desativada para esta estratégia (Estratégias — interruptor da estratégia OFF).';
        }
      } else if (!strategyBinanceOn) {
        reason =
          'Execução Binance desativada para esta estratégia (Estratégias — interruptor da estratégia OFF).';
      } else {
        reason = status.reason;
      }
    }

    return NextResponse.json({
      tradingEnabled: status.tradingEnabled,
      hasCredentials: status.hasCredentials,
      isTestnet: status.isTestnet,
      mainnetTradingEnabled: status.mainnetTradingEnabled,
      mainnetStrategyAllowlist: status.mainnetStrategyAllowlist,
      binanceExecutionOn,
      binancePaused: !binanceExecutionOn,
      strategyBinanceExecutionOn: signalId ? strategyBinanceOn : undefined,
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
        strategy: { select: { name: true, binanceExecutionOn: true, params: true } },
      },
    });

    if (!signal) {
      return NextResponse.json({ error: 'Sinal não encontrado' }, { status: 404 });
    }

    if (
      signal.strategy &&
      !isDirectionEnabledForStrategy(
        signal.strategy.name,
        signal.strategy.params,
        signal.direction as 'BUY' | 'SELL'
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            signal.direction === 'BUY'
              ? 'Compra desativada para Afastamento médio 30m. Liga «Compra» em Estratégias.'
              : 'Venda desativada para Afastamento médio 30m. Liga «Venda» em Estratégias.',
        },
        { status: 400 }
      );
    }

    if (signal.status === 'IN_PROGRESS') {
      return NextResponse.json(
        { success: false, error: 'Sinal já executado' },
        { status: 400 }
      );
    }

    const { binanceExecutionOn } = await getTradingControl();
    if (!binanceExecutionOn) {
      return NextResponse.json(
        {
          success: false,
          error: 'Binance em pausa (interruptor global OFF na página Estratégias).',
        },
        { status: 400 }
      );
    }

    if (signal.strategy && signal.strategy.binanceExecutionOn === false) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Execução Binance desligada para esta estratégia. Liga o interruptor «Binance» dessa estratégia em Estratégias.',
        },
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
