import { NextRequest, NextResponse } from 'next/server';
import { runUniverseScanByCode } from '@/lib/runUniverseScanByCode';
import { UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 } from '@/lib/symbolUniverseDefaults';

/**
 * Cron: Scanner 1 — fecho acima SMA200 em 1h (`UNIVERSE_ABOVE_MA200_1H`).
 * Resposta imediata + scan em background.
 * Auth opcional: `Authorization: Bearer CRON_SECRET`.
 */
async function scanScanner1InBackground(): Promise<void> {
  const code = UNIVERSE_CODE_SCANNER_1_ABOVE_MA200;
  try {
    console.log(`[Cron Scanner1 MA200] Iniciando scan ${code}...`);
    const result = await runUniverseScanByCode(code);
    if (!result.ok) {
      console.error('[Cron Scanner1 MA200]', result.error, result.details ?? '');
      return;
    }
    console.log(
      `[Cron Scanner1 MA200] Concluído: ${result.count} símbolos · gravado=${result.persisted}` +
        (result.persistedRunId ? ` · run ${result.persistedRunId.slice(0, 8)}…` : '')
    );
  } catch (e) {
    console.error('[Cron Scanner1 MA200] Erro fatal:', e);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    void scanScanner1InBackground();

    return NextResponse.json({
      success: true,
      message:
        'Scanner 1 (acima SMA200, 1h) iniciado em background. Consulta /scanners/universos ou /api/symbol-universes/last-scan após alguns minutos.',
      universeCode: UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron scan-scanner-1-ma200:', error);
    return NextResponse.json(
      {
        error: 'Erro ao agendar scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
