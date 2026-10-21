import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { tradingConfig } from '@/lib/bybitTrading';

export const dynamic = 'force-dynamic';

const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';

export interface PerfTrade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  entryPrice: number;
  exitPrice: number | null;
  /** Resultado em % na direção do sinal, sem custos (fechados: na saída; abertos: ao preço atual) */
  resultPct: number | null;
  /** % do capital da posição (tamanho do sinal) */
  weightPct: number;
  hours: number;
  exitReason: string | null;
  execStatus: string | null;
  execResultPct: number | null;
}

function stats(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const sum = xs.reduce((a, b) => a + b, 0);
  const mid = Math.floor(s.length / 2);
  return {
    n: xs.length,
    mean: sum / xs.length,
    median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
    winRate: (xs.filter((x) => x > 0).length / xs.length) * 100,
    sum,
    best: s[s.length - 1],
    worst: s[0],
  };
}

/**
 * Desempenho das estratégias por posição (modelo atual: sinal = posição aberta/fechada).
 * Filtro por data de abertura. Posições abertas avaliadas ao preço atual da Bybit.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom');
    const dateTo = sp.get('dateTo');
    const where: { generatedAt?: { gte?: Date; lte?: Date } } = {};
    if (dateFrom || dateTo) {
      where.generatedAt = {};
      if (dateFrom) where.generatedAt.gte = new Date(`${dateFrom}T00:00:00Z`);
      if (dateTo) where.generatedAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
    const signals = await prisma.signal.findMany({
      where,
      orderBy: { generatedAt: 'asc' },
      select: {
        id: true, symbol: true, direction: true, strategyName: true, status: true, generatedAt: true, exitAt: true,
        entryPrice: true, exitPrice: true, resultPct: true, exitReason: true, extraInfo: true, execStatus: true, execResultPct: true,
      },
    });

    const prices = new Map<string, number>();
    try {
      const r = await fetch(`${BYBIT_BASE_URL}/v5/market/tickers?category=linear`, { cache: 'no-store' });
      const j = await r.json();
      for (const t of j?.result?.list ?? []) prices.set(t.symbol, parseFloat(t.lastPrice));
    } catch {
      /* sem preços: abertas ficam sem resultado */
    }

    const defaultPct = tradingConfig().positionPct;
    const now = Date.now();
    const byStrategy = new Map<string, PerfTrade[]>();
    for (const s of signals) {
      let info: Record<string, unknown> = {};
      try {
        info = JSON.parse(s.extraInfo || '{}');
      } catch {
        /* sem info */
      }
      const weightPct =
        typeof info.weightPct === 'number' && typeof info.sizePct !== 'number'
          ? (info.weightPct as number)
          : typeof info.sizePct === 'number'
            ? (info.sizePct as number)
            : defaultPct;
      const sign = s.direction === 'BUY' ? 1 : -1;
      let res: number | null = null;
      if (s.status === 'CLOSED') res = s.resultPct;
      else {
        const p = prices.get(s.symbol);
        if (p && s.entryPrice) res = ((p - s.entryPrice) / s.entryPrice) * 100 * sign;
      }
      const end = s.exitAt ? s.exitAt.getTime() : now;
      const t: PerfTrade = {
        id: s.id,
        symbol: s.symbol,
        direction: s.direction as 'BUY' | 'SELL',
        status: s.status as 'OPEN' | 'CLOSED',
        openedAt: s.generatedAt.toISOString(),
        closedAt: s.exitAt ? s.exitAt.toISOString() : null,
        entryPrice: s.entryPrice,
        exitPrice: s.status === 'CLOSED' ? s.exitPrice : prices.get(s.symbol) ?? null,
        resultPct: res,
        weightPct,
        hours: (end - s.generatedAt.getTime()) / 3_600_000,
        exitReason: s.exitReason,
        execStatus: s.execStatus,
        execResultPct: s.execResultPct,
      };
      if (!byStrategy.has(s.strategyName)) byStrategy.set(s.strategyName, []);
      byStrategy.get(s.strategyName)!.push(t);
    }

    const strategies = Array.from(byStrategy.entries()).map(([name, trades]) => {
      const closed = trades.filter((t) => t.status === 'CLOSED' && t.resultPct != null);
      const open = trades.filter((t) => t.status === 'OPEN' && t.resultPct != null);
      const all = [...closed, ...open];
      const capital = (ts: PerfTrade[]) => ts.reduce((a, t) => a + ((t.resultPct as number) * t.weightPct) / 100, 0);
      const executed = trades.filter((t) => t.execResultPct != null).map((t) => t.execResultPct as number);
      const days = Array.from(new Set(trades.map((t) => t.openedAt.slice(0, 10)))).length;
      return {
        name,
        signals: trades.length,
        days,
        closed: stats(closed.map((t) => t.resultPct as number)),
        open: stats(open.map((t) => t.resultPct as number)),
        all: stats(all.map((t) => t.resultPct as number)),
        capitalClosedPct: capital(closed),
        capitalOpenPct: capital(open),
        capitalTotalPct: capital(all),
        medianHoursClosed: (() => {
          const h = closed.map((t) => t.hours).sort((a, b) => a - b);
          return h.length ? h[Math.floor(h.length / 2)] : null;
        })(),
        executed: stats(executed),
        trades: trades.slice().reverse(),
      };
    });
    strategies.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ strategies, pricesAt: new Date().toISOString(), defaultPct });
  } catch (error) {
    console.error('Erro em strategy-performance:', error);
    return NextResponse.json({ error: 'Erro ao calcular desempenho', details: error instanceof Error ? error.message : undefined }, { status: 500 });
  }
}
