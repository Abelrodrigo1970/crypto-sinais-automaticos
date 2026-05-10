import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { findStrategiesWithUniverseFallback } from '@/lib/strategyQueries';

export async function GET(request: NextRequest) {
  try {
    // Listagem pública — fallback se BD ainda não tiver SymbolUniverse / FK
    const strategies = await findStrategiesWithUniverseFallback();

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
    const { id, isActive, params, symbolUniverseId } = body;

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
      msg.includes('does not exist');
    return NextResponse.json(
      {
        error: 'Erro ao atualizar estratégia',
        details: msg,
        hint: schemaIssue
          ? 'Na Railway/hosting corre `npx prisma db push` ou migrate para criar SymbolUniverse e symbolUniverseId.'
          : undefined,
      },
      { status: 500 }
    );
  }
}

