import { NextRequest, NextResponse } from 'next/server';
import { runUniverseScanByCode } from '@/lib/runUniverseScanByCode';
import { UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 } from '@/lib/symbolUniverseDefaults';

/**
 * Cron: Scanner 2 — até ±10% da SMA80 em 1h (`UNIVERSE_NEAR_MA200_PCT10_1H`).
 * Resposta imediata + scan em background.
 * Auth opcional: `Authorization: Bearer CRON_SECRET`.
 */
async function scanScanner2InBackground(): Promise<void> {
  const code = UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80;
  try {
    console.log(`[Cron Scanner2 MA80] Iniciando scan ${code}...`);
    const result = await runUniverseScanByCode(code);
    if (!result.ok) {
      console.error('[Cron Scanner2 MA80]', result.error, result.details ?? '');
      return;
    }
    console.log(
      `[Cron Scanner2 MA80] Concluído: ${result.count} símbolos · gravado=${result.persisted}` +
        (result.persistedRunId ? ` · run ${result.persistedRunId.slice(0, 8)}…` : '')
    );
  } catch (e) {
    console.error('[Cron Scanner2 MA80] Erro fatal:', e);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    void scanScanner2InBackground();

    return NextResponse.json({
      success: true,
      message:
        'Scanner 2 (±10% SMA80, 1h) iniciado em background. Consulta /scanners/universos ou /api/symbol-universes/last-scan após alguns minutos.',
      universeCode: UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron scan-scanner-2-ma80:', error);
    return NextResponse.json(
      {
        error: 'Erro ao agendar scan',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
