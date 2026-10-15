import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncStrategies } from '@/lib/signalEngine';
import { STRATEGIES } from '@/lib/strategies';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await syncStrategies();
    const registered = new Map(STRATEGIES.map((s) => [s.name, s]));
    const rows = await prisma.strategy.findMany({
      where: { name: { in: Array.from(registered.keys()) } },
      orderBy: { displayName: 'asc' },
    });
    const strategies = rows.map((r) => {
      const def = registered.get(r.name)!;
      return {
        ...r,
        timeframe: def.timeframe,
        universe: def.universe ?? null,
        defaultParams: def.defaultParams,
      };
    });
    return NextResponse.json({ strategies });
  } catch (error) {
    console.error('Erro ao buscar estratégias:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar estratégias', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, isActive, params } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'ID da estratégia é obrigatório' }, { status: 400 });
    }

    const data: { isActive?: boolean; params?: string } = {};
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (params && typeof params === 'object') data.params = JSON.stringify(params);

    const strategy = await prisma.strategy.update({ where: { id }, data });
    return NextResponse.json({ strategy });
  } catch (error) {
    console.error('Erro ao atualizar estratégia:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar estratégia', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
