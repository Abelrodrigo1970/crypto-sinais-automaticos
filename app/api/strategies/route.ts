import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureMissingBuiltinStrategies } from '@/lib/ensureMissingBuiltinStrategies';
import { findStrategiesWithUniverseFallback } from '@/lib/strategyQueries';

export async function GET(request: NextRequest) {
  try {
    await ensureMissingBuiltinStrategies(prisma);
    // Listagem pública — fallback se BD ainda não tiver SymbolUniverse / FK
    const strategies = await findStrategiesWithUniverseFallback({ activeOnly: false });

    return NextResponse.json({ strategies });
  } catch (error) {
    console.error('Erro ao buscar estratégias:', error);
    return NextResponse.json(
      {
        error: 'Erro ao buscar estratégias',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, isActive, params, symbolUniverseId, binanceExecutionOn } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID da estratégia é obrigatório' },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (typeof isActive === 'boolean') {
      updateData.isActive = isActive;
    }
    if (typeof binanceExecutionOn === 'boolean') {
      updateData.binanceExecutionOn = binanceExecutionOn;
    }
    if (params) {
      updateData.params = JSON.stringify(params);
    }
    if (symbolUniverseId !== undefined) {
      updateData.symbolUniverseId =
        symbolUniverseId === null || symbolUniverseId === ''
          ? null
          : String(symbolUniverseId);
    }

    const strategy = await prisma.strategy.update({
      where: { id },
      data: updateData,
      include: { symbolUniverse: true },
    });

    return NextResponse.json({ strategy });
  } catch (error) {
    console.error('Erro ao atualizar estratégia:', error);
    const msg = error instanceof Error ? error.message : '';
    const schemaIssue =
      msg.includes('symbolUniverse') ||
      msg.includes('SymbolUniverse') ||
      msg.includes('binanceExecutionOn') ||
      msg.includes('does not exist');
    return NextResponse.json(
      {
        error: 'Erro ao atualizar estratégia',
        details: msg,
        hint: schemaIssue
          ? 'Na Railway/hosting corre `npx prisma db push` para criar/atualizar colunas (SymbolUniverse, binanceExecutionOn em Strategy, etc.).'
          : undefined,
      },
      { status: 500 }
    );
  }
}

