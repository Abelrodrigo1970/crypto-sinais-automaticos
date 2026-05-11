import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET ?code=UNIVERSE_ABOVE_MA200_1H — devolve o último scan gravado (rápido, sem chamar Binance).
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'Parâmetro code obrigatório' }, { status: 400 });
  }

  try {
    const run = await prisma.universeScanRun.findFirst({
      where: { universeCode: code },
      orderBy: { scannedAt: 'desc' },
      include: {
        rows: true,
      },
    });

    if (!run) {
      return NextResponse.json({
        found: false,
        count: 0,
        rows: [] as Array<{ symbol: string; close: number; ma: number; pctFromMa: number }>,
      });
    }

    const rows = run.rows
      .map((r) => ({
        symbol: r.symbol,
        close: r.close,
        ma: r.ma,
        pctFromMa: r.pctFromMa,
      }))
      .sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa));

    return NextResponse.json({
      found: true,
      count: rows.length,
      rows,
      scannedAt: run.scannedAt.toISOString(),
      runId: run.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[last-scan]', msg);
    return NextResponse.json({
      found: false,
      count: 0,
      rows: [] as Array<{ symbol: string; close: number; ma: number; pctFromMa: number }>,
      unavailable: true,
      note:
        'Histórico de scans indisponível (tabela em falta ou erro). Corre `npx prisma db push` ou executa um scan manual.',
    });
  }
}
