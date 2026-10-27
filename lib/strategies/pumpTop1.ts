import { prisma } from '../db';
import { fetchCandles, fetchCurrentPrice, type Candle } from '../marketData';
import type { PortfolioStrategyDefinition } from './types';

type Params = {
  /** Posição no ranking do Scanner Pump 24h que se compra (1 = top 1) */
  rank: number;
  /** Variação 24h mínima no scan (%) */
  minChange24h: number;
  /** Só compra se o BTC subiu nas 24h anteriores ao scan */
  btcFilter: boolean;
  stopPct: number;
  targetPct: number;
  holdHours: number;
  /** Só entra em scans feitos há menos disto (minutos) */
  maxEntryDelayMin: number;
  sizePct: number;
  maxPositions: number;
  leverage: number;
  excludeSymbols: string[];
};

const PUMP_HISTORY_URL =
  process.env.PUMP_HISTORY_URL || 'https://claudebot-production-d67d.up.railway.app/api/scanner/pump/history';
const HOUR = 3_600_000;
const M15 = 15 * 60_000;

type PumpRow = { rank: number; symbol: string; price: string; change_24h: string; scanned_at: string };
type PumpSession = { scanned_at: string; results: PumpRow[] };

/** "Q/USDT:USDT" → "QUSDT" */
function toBybit(sym: string): string {
  return sym.split(':')[0].replace('/', '');
}

async function fetchPumpSessions(n: number): Promise<PumpSession[]> {
  const res = await fetch(`${PUMP_HISTORY_URL}?sessions=${n}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} no histórico do Scanner Pump`);
  const j = await res.json();
  return Array.isArray(j) ? j : [];
}

/** Variação do BTC entre a abertura da hora do scan e a abertura 24h antes (só velas conhecidas no scan) */
async function btcChange24h(scanAt: number): Promise<number | null> {
  const h = await fetchCandles('BTCUSDT', '1h', 60, { includeOpenCandle: true });
  const h0 = Math.floor(scanAt / HOUR) * HOUR;
  const a = h.find((c) => c.timestamp === h0);
  const b = h.find((c) => c.timestamp === h0 - 24 * HOUR);
  return a && b ? (a.open / b.open - 1) * 100 : null;
}

function parseInfo(extraInfo: string | null): Record<string, any> {
  try {
    return JSON.parse(extraInfo || '{}');
  } catch {
    return {};
  }
}

/**
 * Saída pelas velas de 15m fechadas desde a entrada: stop primeiro (pior caso, como no backtest), depois o alvo;
 * preço = nível, ou a abertura se a vela abriu já para lá dele. Sem toque, fecha no fecho da vela que acaba às `holdHours`.
 */
export function decideExit(
  bars: Candle[],
  entry: number,
  entryAt: number,
  p: Pick<Params, 'stopPct' | 'targetPct' | 'holdHours'>,
  now: number
): { price: number; at: number; reason: string } | null {
  const end = entryAt + p.holdHours * HOUR;
  const stopPx = entry * (1 - p.stopPct / 100);
  const tgtPx = entry * (1 + p.targetPct / 100);
  let last: Candle | null = null;
  for (const b of bars) {
    if (b.timestamp < entryAt || b.timestamp + M15 > end) continue;
    if (b.low <= stopPx) return { price: Math.min(b.open, stopPx), at: b.timestamp + M15, reason: `stop −${p.stopPct}%` };
    if (b.high >= tgtPx) return { price: Math.max(b.open, tgtPx), at: b.timestamp + M15, reason: `alvo +${p.targetPct}%` };
    last = b;
  }
  if (now >= end + M15 && last) return { price: last.close, at: last.timestamp + M15, reason: `${p.holdHours}h depois da entrada` };
  return null;
}

/**
 * Top 1 do Scanner Pump 24h (backtest jan–out/2026, scratchpad p3/top1_btc.py): long no #1 de cada scan (a cada 2h,
 * variação 24h ≥ 10%) quando o BTC subiu nas 24h anteriores; stop −25%, alvo +80%, ou 24h. Com custos e funding:
 * ano simulado +3,0%/trade (587 trades, 8/10 meses positivos); histórico real da app 25/08–25/10 +5,3%/trade (94).
 * Depende de poucos pumps grandes (sem os 20 melhores ≈ 0). Só estudo: não envia ordens à Bybit.
 */
export const pumpTop1: PortfolioStrategyDefinition<Params> = {
  kind: 'portfolio',
  name: 'PUMP24_TOP1_BTC',
  displayName: 'Scanner Pump 24h — top 1 com BTC a subir',
  description:
    'Lê o Scanner Pump 24h do claude_bot (scan a cada 2h, moedas com variação 24h ≥ 10%). Compra a moeda em #1 logo a seguir ao scan, ' +
    'só se o BTC subiu nas 24h anteriores. Stop −25%, alvo +80%, ou fecha 24h depois. Uma posição por moeda. ' +
    'Só estudo: não envia ordens à Bybit.',
  timeframe: '15m',
  defaultParams: {
    rank: 1,
    minChange24h: 10,
    btcFilter: true,
    stopPct: 25,
    targetPct: 80,
    holdHours: 24,
    maxEntryDelayMin: 100,
    sizePct: 2,
    maxPositions: 10,
    leverage: 1,
    excludeSymbols: [],
  },

  async run({ strategy, params }) {
    const stats = { opened: 0, closed: 0, updated: 0 };
    const now = Date.now();

    // 1) Saídas
    const open = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' } });
    for (const sig of open) {
      try {
        const info = parseInfo(sig.extraInfo);
        const entryAt = typeof info.entryAt === 'number' ? info.entryAt : sig.generatedAt.getTime();
        const n = Math.min(1000, Math.ceil((now - entryAt) / M15) + 2);
        const bars = await fetchCandles(sig.symbol, '15m', n);
        const ex = decideExit(bars, sig.entryPrice, entryAt, params, now);
        if (!ex) {
          await prisma.signal.update({ where: { id: sig.id }, data: { lastCheckedAt: new Date() } });
          stats.updated++;
          continue;
        }
        await prisma.signal.update({
          where: { id: sig.id },
          data: {
            status: 'CLOSED',
            exitPrice: ex.price,
            exitAt: new Date(ex.at),
            resultPct: (ex.price / sig.entryPrice - 1) * 100,
            exitReason: ex.reason,
            lastCheckedAt: new Date(),
          },
        });
        stats.closed++;
      } catch (error) {
        console.error(`[${pumpTop1.name}] erro a gerir ${sig.symbol}:`, error instanceof Error ? error.message : error);
      }
    }

    // 2) Entradas: #rank dos scans recentes ainda não tratados
    let sessions: PumpSession[];
    try {
      sessions = await fetchPumpSessions(3);
    } catch (error) {
      console.error(`[${pumpTop1.name}] sem histórico do Scanner Pump:`, error instanceof Error ? error.message : error);
      return stats;
    }
    const exclude = new Set(params.excludeSymbols ?? []);
    const recent = sessions
      .map((s) => ({ at: Date.parse(s.scanned_at), row: s.results.find((r) => r.rank === params.rank) }))
      .filter((s) => Number.isFinite(s.at) && now - s.at <= params.maxEntryDelayMin * 60_000 && now >= s.at)
      .sort((a, b) => a.at - b.at);

    for (const s of recent) {
      const barTime = new Date(s.at);
      if (await prisma.signal.findFirst({ where: { strategyId: strategy.id, barTime }, select: { id: true } })) continue;
      if (!s.row) continue;
      const symbol = toBybit(s.row.symbol);
      const change = parseFloat(s.row.change_24h);
      const label = `${barTime.toISOString().slice(0, 16)} #${params.rank} ${symbol} (${change.toFixed(1)}%)`;
      if (!(change >= params.minChange24h) || exclude.has(symbol)) continue;

      const btc = await btcChange24h(s.at).catch(() => null);
      if (params.btcFilter && !(btc !== null && btc > 0)) {
        console.log(`[${pumpTop1.name}] ${label}: BTC 24h ${btc === null ? 'sem dados' : btc.toFixed(2) + '%'} → não entra`);
        continue;
      }
      const openNow = await prisma.signal.findMany({ where: { strategyId: strategy.id, status: 'OPEN' }, select: { symbol: true } });
      if (openNow.some((o) => o.symbol === symbol)) {
        console.log(`[${pumpTop1.name}] ${label}: já em posição`);
        continue;
      }
      if (openNow.length >= params.maxPositions) {
        console.log(`[${pumpTop1.name}] ${label}: máximo de ${params.maxPositions} posições`);
        continue;
      }
      let price: number;
      try {
        price = await fetchCurrentPrice(symbol);
      } catch {
        console.log(`[${pumpTop1.name}] ${label}: sem preço na Bybit`);
        continue;
      }
      if (!Number.isFinite(price) || price <= 0) continue;

      await prisma.signal.create({
        data: {
          symbol,
          direction: 'BUY',
          timeframe: '15m',
          strategyId: strategy.id,
          strategyName: strategy.displayName,
          entryPrice: price,
          stopLoss: price * (1 - params.stopPct / 100),
          target1: price * (1 + params.targetPct / 100),
          strength: Math.min(100, Math.round(60 + change / 5)),
          status: 'OPEN',
          barTime,
          extraInfo: JSON.stringify({
            source: 'bybit',
            scanAt: s.at,
            rank: params.rank,
            change24h: change,
            scanPrice: parseFloat(s.row.price),
            btc24hPct: btc,
            entryAt: Date.now(),
            atrasoMin: Math.round((Date.now() - s.at) / 60_000),
            sizePct: params.sizePct,
            leverage: params.leverage,
          }),
        },
      });
      console.log(`[${pumpTop1.name}] ${label}: BTC 24h ${btc?.toFixed(2)}% → compra a ${price}`);
      stats.opened++;
      // Só estudo: sem openPosition()
    }
    return stats;
  },
};
