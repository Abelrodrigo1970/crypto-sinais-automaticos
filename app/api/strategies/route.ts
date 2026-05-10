import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Listagem pública - necessário para o dropdown de filtros no dashboard
    const strategies = await prisma.strategy.findMany({
      orderBy: { name: 'asc' },
      include: {
        symbolUniverse: true,
      },
    });

    return NextResponse.json({ strategies });
  } catch (error) {
    console.error('Erro ao buscar estratégias:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar estratégias' },
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
    return NextResponse.json(
      { error: 'Erro ao atualizar estratégia' },
      { status: 500 }
    );
  }
}

