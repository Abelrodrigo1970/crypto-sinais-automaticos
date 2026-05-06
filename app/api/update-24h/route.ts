import { NextRequest, NextResponse } from 'next/server';
import { update24hResults } from '@/lib/update24hResults';

/**
 * Endpoint para atualizar resultados após 24 horas dos sinais
 * Pode ser chamado manualmente ou via cron
 */
export async function POST(request: NextRequest) {
  try {
    const result = await update24hResults();

    return NextResponse.json({
      success: true,
      updated: result.updated,
      errors: result.errors,
      message: `${result.updated} sinal(is) atualizado(s) com resultado 24h`,
    });
  } catch (error) {
    console.error('Erro ao atualizar resultados 24h:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao atualizar resultados 24h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

/**
 * GET também funciona para facilitar chamadas via cron
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const result = await update24hResults();

    return NextResponse.json({
      success: true,
      updated: result.updated,
      errors: result.errors,
      message: `${result.updated} sinal(is) atualizado(s) com resultado 24h`,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao atualizar resultados 24h:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao atualizar resultados 24h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

