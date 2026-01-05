import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { runScanner, type ScannerConfig } from '@/lib/scannerAplus';

/**
 * Endpoint para executar o scanner A+
 * GET: Retorna alertas do scanner
 * POST: Executa scanner com configuração customizada
 */
export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    
    // Configuração via query params
    const config: Partial<ScannerConfig> = {
      topSymbolsLimit: searchParams.get('topSymbolsLimit')
        ? parseInt(searchParams.get('topSymbolsLimit')!)
        : undefined,
      minQuoteVolume: searchParams.get('minQuoteVolume')
        ? parseFloat(searchParams.get('minQuoteVolume')!)
        : undefined,
      minATRPercent: searchParams.get('minATRPercent')
        ? parseFloat(searchParams.get('minATRPercent')!)
        : undefined,
      maxATRPercent: searchParams.get('maxATRPercent')
        ? parseFloat(searchParams.get('maxATRPercent')!)
        : undefined,
      minEntryScore: searchParams.get('minEntryScore')
        ? parseInt(searchParams.get('minEntryScore')!)
        : undefined,
      topNAlerts: searchParams.get('topNAlerts')
        ? parseInt(searchParams.get('topNAlerts')!)
        : undefined,
      enableBreakoutRetest: searchParams.get('enableBreakoutRetest') === 'true',
      breakoutPeriod: searchParams.get('breakoutPeriod')
        ? parseInt(searchParams.get('breakoutPeriod')!)
        : undefined,
      cooldownMinutes: searchParams.get('cooldownMinutes')
        ? parseInt(searchParams.get('cooldownMinutes')!)
        : undefined,
    };

    const result = await runScanner(config);

    return NextResponse.json({
      success: true,
      entries: result.entries,
      preSetups: result.preSetups,
      count: {
        entries: result.entries.length,
        preSetups: result.preSetups.length,
      },
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao executar scanner A+:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao executar scanner',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const config: Partial<ScannerConfig> = body.config || {};

    const result = await runScanner(config);

    return NextResponse.json({
      success: true,
      entries: result.entries,
      preSetups: result.preSetups,
      count: {
        entries: result.entries.length,
        preSetups: result.preSetups.length,
      },
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao executar scanner A+:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao executar scanner',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}



