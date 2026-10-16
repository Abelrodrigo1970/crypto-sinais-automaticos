import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {},
  };

  try {
    // Verificar variáveis de ambiente
    health.checks.env = {
      DATABASE_URL: process.env.DATABASE_URL ? '✅ Configurado' : '❌ Não configurado',
      NODE_ENV: process.env.NODE_ENV || 'not set',
    };

    const isPostgreSQL = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || '');
    health.checks.database = { type: isPostgreSQL ? 'postgresql' : 'sqlite' };

    // Tentar conectar ao banco
    try {
      const strategyCount = await prisma.strategy.count();
      health.checks.database.connection = '✅ Conectado';
      health.checks.database.strategies = strategyCount;
    } catch (dbError: any) {
      health.checks.database.connection = '❌ Erro de conexão';
      health.status = 'error';
    }

    return NextResponse.json(health, {
      status: health.status === 'ok' ? 200 : 500,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'error',
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}






