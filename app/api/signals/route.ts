import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Garantir que o banco está inicializado
    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json(
        {
          error: 'Banco de dados não está pronto',
          hint: 'Tente acessar /api/init-db para inicializar manualmente',
        },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const direction = searchParams.get('direction');
    const timeframe = searchParams.get('timeframe');
    const strategy = searchParams.get('strategy');
    const minStrength = searchParams.get('minStrength');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const onlyOpen = searchParams.get('onlyOpen') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: any = {};

    if (symbol) {
      where.symbol = { contains: symbol };
    }
    if (direction && (direction === 'BUY' || direction === 'SELL')) {
      where.direction = direction;
    }
    if (timeframe) {
      where.timeframe = timeframe;
    }
    if (strategy) {
      where.strategyName = { contains: strategy };
    }
    // Aplicar filtro padrão de 40 se não especificado
    const minStrengthValue = minStrength ? parseInt(minStrength) : 40;
    where.strength = { gte: minStrengthValue };
    
    // Filtros de data
    if (dateFrom || dateTo) {
      where.generatedAt = {};
      if (dateFrom) {
        where.generatedAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        // Adicionar 23:59:59 ao final do dia para incluir todo o dia
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.generatedAt.lte = endDate;
      }
    }
    
    // Filtro para mostrar apenas sinais sem resultado 24h
    if (onlyOpen) {
      where.status24h = null;
    }
    
    // Filtro para mostrar apenas sinais com resultado 24h (para página de resultados)
    const onlyClosed = searchParams.get('onlyClosed') === 'true';
    if (onlyClosed) {
      where.status24h = 'CLOSED';
      where.result24h = { not: null };
    }

    const signals = await prisma.signal.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
      take: limit,
      include: {
        strategy: true,
      },
    });

    return NextResponse.json({ signals });
  } catch (error) {
    console.error('Erro ao buscar sinais:', error);
    return NextResponse.json(
      { 
        error: 'Erro ao buscar sinais',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}

