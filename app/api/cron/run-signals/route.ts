import { NextRequest, NextResponse } from 'next/server';
import { runAllStrategies } from '@/lib/signalEngine';
import { update24hResults, updateMissingHighLow24h } from '@/lib/update24hResults';

/**
 * Endpoint de cron para executar sinais automaticamente
 * Verifica se está no horário permitido (8:00 - 23:59)
 * Executa a cada hora (8:00, 9:00, 10:00, ..., 23:00)
 * Pode ser chamado por serviços externos como cron-job.org
 */
export async function GET(request: NextRequest) {
  try {
    // Verificar se tem token de segurança (opcional, mas recomendado)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Obter hora atual (UTC ou timezone configurado)
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Verificar se está no horário permitido (8:00 - 23:59)
    if (hour < 8 || hour > 23) {
      return NextResponse.json({
        success: false,
        message: `Fora do horário permitido. Horário atual: ${hour}:${minute.toString().padStart(2, '0')}. Permitido: 8:00 - 23:59`,
        currentTime: `${hour}:${minute.toString().padStart(2, '0')}`,
      });
    }

    // Executar motor de sinais
    const signalsCreated = await runAllStrategies();

    // Atualizar resultados 24h
    const update24h = await update24hResults();

    // Atualizar sinais já fechados que não têm high24h/low24h (apenas uma vez por dia às 8:00)
    let updateHighLow = { updated: 0, errors: 0 };
    if (hour === 8 && minute < 10) {
      updateHighLow = await updateMissingHighLow24h();
    }

    return NextResponse.json({
      success: true,
      signalsCreated,
      update24h: {
        updated: update24h.updated,
        errors: update24h.errors,
      },
      updateHighLow: {
        updated: updateHighLow.updated,
        errors: updateHighLow.errors,
      },
      message: `${signalsCreated} novo(s) sinal(is) gerado(s), ${update24h.updated} resultado(s) 24h atualizado(s)${updateHighLow.updated > 0 ? `, ${updateHighLow.updated} high/low atualizado(s)` : ''}`,
      executedAt: now.toISOString(),
      nextExecution: hour < 23 ? `${hour + 1}:00` : '8:00 (amanhã)',
    });
  } catch (error) {
    console.error('Erro no cron job:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao executar cron job',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

