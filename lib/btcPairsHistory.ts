import { prisma } from './db';
import { fetchCandles, type Candle } from './marketData';
import { fetchAllPerps, mapLimit } from './strategies/scanner10';
import { getBtcPairs, type BtcPair } from './btcPairs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Primeira lista do histórico */
export const HISTORY_START = Date.UTC(2026, 8, 1); // 1 de setembro de 2026

/** Hora em Lisboa (0–23) de um instante UTC */
function lisbonHour(t: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hourCycle: 'h23' }).format(t));
}

/** Instantes (ms UTC) de todas as segundas-feiras às 01:00 de Lisboa entre `from` e `to` */
export function mondaysAt1Lisbon(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = Math.floor(from / DAY) * DAY; d <= to; d += DAY) {
    if (new Date(d).getUTCDay() !== 1) continue;
    // 01:00 em Lisboa é 00:00 UTC no horário de verão e 01:00 UTC no de inverno
    const t = [d, d + HOUR].find((x) => lisbonHour(x) === 1);
    if (t !== undefined && t >= from && t <= to) out.push(t);
  }
  return out;
}

const pct = (a: number, b: number) => (a / b - 1) * 100;

/** Fecho da vela de 1h que acaba em `t` (abre em t − 1h) */
function closeAt(byTime: Map<number, Candle>, t: number): number | null {
  return byTime.get(t - HOUR)?.close ?? null;
}

/**
 * Reconstrói as listas dos instantes `times` a partir de velas de 1h da Bybit: preço da moeda e do BTC no
 * fecho da vela que acaba nesse instante; variações do rácio a 24h/7d/30d; volume 24h = soma das 24 velas.
 * Usa os perpétuos em negociação hoje (moedas entretanto retiradas não aparecem).
 */
export async function buildSnapshots(times: number[]): Promise<Map<number, { btcPrice: number; pairs: BtcPair[] }>> {
  const out = new Map<number, { btcPrice: number; pairs: BtcPair[] }>();
  if (!times.length) return out;
  const first = Math.min(...times) - 31 * DAY;
  const last = Math.max(...times);
  const bars = Math.ceil((last - first) / HOUR) + 2;
  const load = async (symbol: string) => {
    const c = await fetchCandles(symbol, '1h', bars, { endTime: last - 1 });
    return new Map(c.map((x) => [x.timestamp, x]));
  };
  const btc = await load('BTCUSDT');
  const perps = (await fetchAllPerps()).filter((p) => p.symbol !== 'BTCUSDT');
  const live = await getBtcPairs().catch(() => null); // só para os pares spot reais (estado atual)
  const real = new Map((live?.pairs ?? []).map((p) => [p.symbol, p.realPair]));

  const series = await mapLimit(perps, 8, async (p) => {
    try {
      return [p.symbol, await load(p.symbol)] as const;
    } catch {
      return [p.symbol, null] as const;
    }
  });

  for (const t of times) {
    const btcNow = closeAt(btc, t);
    if (!btcNow) continue;
    const pairs: BtcPair[] = [];
    for (const [symbol, s] of series) {
      if (!s) continue;
      const now = closeAt(s, t);
      if (!now) continue;
      const ratioAt = (x: number) => {
        const a = closeAt(s, x);
        const b = closeAt(btc, x);
        return a && b ? a / b : null;
      };
      const r = now / btcNow;
      const r24 = ratioAt(t - DAY);
      const r7 = ratioAt(t - 7 * DAY);
      const r30 = ratioAt(t - 30 * DAY);
      let turnover = 0;
      let hi = 0;
      for (let k = 1; k <= 30 * 24; k++) {
        const bar = s.get(t - k * HOUR);
        if (k <= 24 && bar) turnover += bar.turnover ?? bar.volume * bar.close;
        const rk = ratioAt(t - (k - 1) * HOUR);
        if (rk && rk > hi) hi = rk;
      }
      const p24 = closeAt(s, t - DAY);
      const base = symbol.replace(/USDT$/, '');
      pairs.push({
        base,
        symbol,
        ratio: r,
        priceUsdt: now,
        turnover24h: turnover,
        chgUsdt24h: p24 ? pct(now, p24) : null,
        chg24h: r24 ? pct(r, r24) : null,
        chg7d: r7 ? pct(r, r7) : null,
        chg30d: r30 ? pct(r, r30) : null,
        fromHigh30d: hi ? pct(r, hi) : null,
        realPair: real.get(symbol) ?? { bybit: false, binance: null },
      });
    }
    pairs.sort((a, b) => b.turnover24h - a.turnover24h);
    out.set(t, { btcPrice: btcNow, pairs });
  }
  return out;
}

let running: Promise<number> | null = null;

/**
 * Garante que existe uma lista para cada segunda-feira 01:00 de Lisboa desde 1 de setembro até agora.
 * Na primeira vez reconstrói todas as semanas; depois só a da semana nova. Devolve quantas criou.
 */
export function ensureWeeklyBtcSnapshots(): Promise<number> {
  if (running) return running;
  running = (async () => {
    const due = mondaysAt1Lisbon(HISTORY_START, Date.now() - 5 * 60_000);
    const have = new Set(
      (await prisma.btcPairsSnapshot.findMany({ select: { takenAt: true } })).map((s) => s.takenAt.getTime())
    );
    const missing = due.filter((t) => !have.has(t));
    if (!missing.length) return 0;
    const built = await buildSnapshots(missing);
    let created = 0;
    for (const [t, snap] of built) {
      await prisma.btcPairsSnapshot.upsert({
        where: { takenAt: new Date(t) },
        create: { takenAt: new Date(t), btcPrice: snap.btcPrice, count: snap.pairs.length, data: JSON.stringify(snap.pairs) },
        update: {},
      });
      created++;
    }
    console.log(`[Pares BTC] ${created} listas semanais criadas (${missing.map((t) => new Date(t).toISOString().slice(0, 16)).join(', ')})`);
    return created;
  })().finally(() => {
    running = null;
  });
  return running;
}
