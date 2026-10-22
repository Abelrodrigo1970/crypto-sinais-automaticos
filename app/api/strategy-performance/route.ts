import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { tradingConfig } from '@/lib/bybitTrading';
import { fetchFunding } from '@/lib/bybitFunding';

export const dynamic = 'force-dynamic';

const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
/** Comissão taker da Bybit nos perpétuos (nível base), por lado, em % */
const DEFAULT_FEE_PCT = 0.055;
/** Slippage assumido por lado, em %, quando não há execução real */
const DEFAULT_SLIP_PCT = 0.05;

export interface PerfTrade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  entryPrice: number;
  /** Fechadas: preço (médio) de saída; abertas: preço a que se fecharia agora (bid no long, ask no short) */
  exitPrice: number | null;
  /** Resultado bruto em %, na direção do sinal (preços de execução quando houve ordens reais) */
  grossPct: number | null;
  /** Comissões (entrada + saída), em % (negativo) */
  feesPct: number;
  /** Slippage assumido (entrada + saída), em % (negativo); 0 quando há execução real */
  slipPct: number;
  /** Funding pago (−) ou recebido (+) durante a posição, em % */
  fundingPct: number;
  /** Resultado líquido em % = bruto + comissões + slippage + funding */
  resultPct: number | null;
  /** % do capital da posição (tamanho do sinal) */
  weightPct: number;
  hours: number;
  exitReason: string | null;
  execStatus: string | null;
  /** O resultado bruto usa os preços de execução reais da Bybit */
  executed: boolean;
  /** Já houve vendas parciais: fração ainda aberta (1 = posição inteira) */
  left: number;
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

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const num = (v: string | null, d: number) => {
  const x = v == null ? NaN : parseFloat(v);
  return Number.isFinite(x) && x >= 0 && x < 5 ? x : d;
};

/**
 * Desempenho das estratégias por posição (sinal = posição aberta/fechada), o mais perto possível do real:
 * resultado líquido de comissões, slippage e funding; abertas avaliadas ao bid/ask atual.
 * Filtro por data de abertura.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom');
    const dateTo = sp.get('dateTo');
    const feeSide = num(sp.get('feePct'), DEFAULT_FEE_PCT);
    const slipSide = num(sp.get('slipPct'), DEFAULT_SLIP_PCT);
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

    const quote = new Map<string, { last: number; bid: number; ask: number }>();
    try {
      const r = await fetch(`${BYBIT_BASE_URL}/v5/market/tickers?category=linear`, { cache: 'no-store' });
      const j = await r.json();
      for (const t of j?.result?.list ?? []) {
        const last = parseFloat(t.lastPrice);
        const bid = parseFloat(t.bid1Price);
        const ask = parseFloat(t.ask1Price);
        quote.set(t.symbol, { last, bid: bid > 0 ? bid : last, ask: ask > 0 ? ask : last });
      }
    } catch {
      /* sem preços: abertas ficam sem resultado */
    }

    // Funding: um pedido por símbolo, desde a abertura mais antiga
    const firstOpen = new Map<string, number>();
    for (const s of signals) {
      const t = s.generatedAt.getTime();
      firstOpen.set(s.symbol, Math.min(firstOpen.get(s.symbol) ?? t, t));
    }
    const funding = new Map<string, Array<{ t: number; rate: number }>>();
    let fundingErrors = 0;
    await mapLimit(Array.from(firstOpen.entries()), 8, async ([sym, from]) => {
      try {
        funding.set(sym, await fetchFunding(sym, from));
      } catch {
        fundingErrors++;
      }
    });

    const defaultPct = tradingConfig().positionPct;
    const now = Date.now();
    const byStrategy = new Map<string, PerfTrade[]>();
    for (const s of signals) {
      let info: Record<string, any> = {};
      try {
        info = JSON.parse(s.extraInfo || '{}');
      } catch {
        /* sem info */
      }
      const weightPct =
        typeof info.weightPct === 'number' && typeof info.sizePct !== 'number'
          ? info.weightPct
          : typeof info.sizePct === 'number'
            ? info.sizePct
            : defaultPct;
      const sign = s.direction === 'BUY' ? 1 : -1;
      const fills: Array<{ frac: number; price: number; at: number }> = Array.isArray(info.fills) ? info.fills : [];
      const q = quote.get(s.symbol);
      // a saída de um long vende ao bid; a de um short compra ao ask
      const closeNow = q ? (sign > 0 ? q.bid : q.ask) : null;
      const executed = s.execResultPct != null && s.status === 'CLOSED';

      let gross: number | null = null;
      let exitPrice: number | null = null;
      let left = 1;
      if (executed) {
        gross = s.execResultPct;
        exitPrice = s.exitPrice;
        left = 0;
      } else if (s.status === 'CLOSED') {
        gross = s.resultPct;
        exitPrice = s.exitPrice;
        left = 0;
      } else if (closeNow && s.entryPrice) {
        left = typeof info.left === 'number' ? info.left : 1;
        const sold = fills.reduce((a, f) => a + f.frac * (f.price / s.entryPrice - 1), 0);
        gross = (sold + left * (closeNow / s.entryPrice - 1)) * 100 * sign;
        exitPrice = closeNow;
      }

      // funding: a cada liquidação, quem está long paga a taxa (se positiva); proporcional à fração aberta
      const start = s.generatedAt.getTime();
      const end = s.exitAt ? s.exitAt.getTime() : now;
      const leftAt = (t: number) => Math.max(0, 1 - fills.filter((f) => f.at <= t).reduce((a, f) => a + f.frac, 0));
      const fundingPct = -sign * (funding.get(s.symbol) ?? []).filter((p) => p.t > start && p.t <= end).reduce((a, p) => a + p.rate * leftAt(p.t), 0) * 100;

      const feesPct = -2 * feeSide;
      const slipPct = executed ? 0 : -2 * slipSide;
      const t: PerfTrade = {
        id: s.id,
        symbol: s.symbol,
        direction: s.direction as 'BUY' | 'SELL',
        status: s.status as 'OPEN' | 'CLOSED',
        openedAt: s.generatedAt.toISOString(),
        closedAt: s.exitAt ? s.exitAt.toISOString() : null,
        entryPrice: s.entryPrice,
        exitPrice,
        grossPct: gross,
        feesPct,
        slipPct,
        fundingPct,
        resultPct: gross == null ? null : gross + feesPct + slipPct + fundingPct,
        weightPct,
        hours: (end - start) / 3_600_000,
        exitReason: s.exitReason,
        execStatus: s.execStatus,
        executed,
        left,
      };
      if (!byStrategy.has(s.strategyName)) byStrategy.set(s.strategyName, []);
      byStrategy.get(s.strategyName)!.push(t);
    }

    const capital = (ts: PerfTrade[], k: 'resultPct' | 'grossPct' = 'resultPct') => ts.reduce((a, t) => a + ((t[k] as number) * t.weightPct) / 100, 0);
    const avg = (ts: PerfTrade[], f: (t: PerfTrade) => number) => (ts.length ? ts.reduce((a, t) => a + f(t), 0) / ts.length : 0);
    const strategies = Array.from(byStrategy.entries()).map(([name, trades]) => {
      const closed = trades.filter((t) => t.status === 'CLOSED' && t.resultPct != null);
      const open = trades.filter((t) => t.status === 'OPEN' && t.resultPct != null);
      const all = [...closed, ...open];
      const days = Array.from(new Set(trades.map((t) => t.openedAt.slice(0, 10)))).length;
      return {
        name,
        signals: trades.length,
        days,
        closed: stats(closed.map((t) => t.resultPct as number)),
        open: stats(open.map((t) => t.resultPct as number)),
        all: stats(all.map((t) => t.resultPct as number)),
        grossMean: all.length ? avg(all, (t) => t.grossPct as number) : null,
        costs: { fees: avg(all, (t) => t.feesPct), slip: avg(all, (t) => t.slipPct), funding: avg(all, (t) => t.fundingPct) },
        capitalClosedPct: capital(closed),
        capitalOpenPct: capital(open),
        capitalTotalPct: capital(all),
        capitalGrossPct: capital(all, 'grossPct'),
        /** Capital investido agora (soma dos pesos das abertas × fração ainda aberta) */
        investedPct: open.reduce((a, t) => a + t.weightPct * t.left, 0),
        medianHoursClosed: (() => {
          const h = closed.map((t) => t.hours).sort((a, b) => a - b);
          return h.length ? h[Math.floor(h.length / 2)] : null;
        })(),
        executedCount: trades.filter((t) => t.executed).length,
        trades: trades.slice().reverse(),
      };
    });
    strategies.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({
      strategies,
      pricesAt: new Date().toISOString(),
      defaultPct,
      costs: { feePct: feeSide, slipPct: slipSide, fundingErrors },
    });
  } catch (error) {
    console.error('Erro em strategy-performance:', error);
    return NextResponse.json({ error: 'Erro ao calcular desempenho', details: error instanceof Error ? error.message : undefined }, { status: 500 });
  }
}
