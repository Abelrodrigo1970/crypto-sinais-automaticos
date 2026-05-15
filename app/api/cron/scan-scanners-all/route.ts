import { NextRequest, NextResponse } from 'next/server';
import { runUniverseScanByCode } from '@/lib/runUniverseScanByCode';
import {
  UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80,
  UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
  UNIVERSE_CODE_SCANNER_3_MA80_PCT4,
} from '@/lib/symbolUniverseDefaults';

/**
 * Cron: corrê os 3 scanners em sequência em background (Scanner 1 → 2 → 3).
 * Mesma auth opcional que os endpoints individuais: `Authorization: Bearer CRON_SECRET`.
 */
async function scanAllScannersInBackground(): Promise<void> {
  const scanners: Array<{ label: string; code: string }> = [
    { label: 'Scanner1 MA200', code: UNIVERSE_CODE_SCANNER_1_ABOVE_MA200 },
    { label: 'Scanner2 MA80±10%', code: UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 },
    { label: 'Scanner3 MA80±4%', code: UNIVERSE_CODE_SCANNER_3_MA80_PCT4 },
  ];

  for (const { label, code } of scanners) {
    try {
      console.log(`[Cron All Scanners] (${label}) iniciando ${code}...`);
      const result = await runUniverseScanByCode(code);
      if (!result.ok) {
        console.error(`[Cron All Scanners] (${label})`, result.error, result.details ?? '');
        continue;
      }
      console.log(
        `[Cron All Scanners] (${label}) concluído: ${result.count} símbolos · gravado=${result.persisted}` +
          (result.persistedRunId ? ` · run ${result.persistedRunId.slice(0, 8)}…` : '')
      );
    } catch (e) {
      console.error(`[Cron All Scanners] (${label}) erro fatal:`, e);
    }
  }
  console.log('[Cron All Scanners] Sequência terminada.');
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    void scanAllScannersInBackground();

    return NextResponse.json({
      success: true,
      message:
        'Scanners 1, 2 e 3 agendados em sequência em background (1→2→3). Consulta /scanners/universos após vários minutos.',
      scanners: [
        UNIVERSE_CODE_SCANNER_1_ABOVE_MA200,
        UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80,
        UNIVERSE_CODE_SCANNER_3_MA80_PCT4,
      ],
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro no cron scan-scanners-all:', error);
    return NextResponse.json(
      {
        error: 'Erro ao agendar scans',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
