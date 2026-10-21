/**
 * Regime do prémio da Coinbase (procura spot nos EUA): prémio diário = fecho BTC-USD na Coinbase ÷ fecho BTCUSDT
 * (perpétuo Bybit) − 1, por dia UTC. Regime positivo quando a média de 7 dias > média de 90 dias (como no backtest
 * s9/s10_tp_60d_cb2.py e cb_port_ytd.py).
 */
import { fetchCandles } from './marketData';

const COINBASE = 'https://api.exchange.coinbase.com/products/BTC-USD/candles';
const DAY = 86_400_000;

export interface PremiumRegime {
  /** Abertura (ms) do dia avaliado */
  day: number;
  on: boolean;
  /** Médias do prémio, em % */
  avg7: number;
  avg90: number;
  last: number;
}

async function coinbaseDailyCloses(): Promise<Map<number, number>> {
  const res = await fetch(`${COINBASE}?granularity=86400`, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const rows: number[][] = await res.json();
  // [time (s), low, high, open, close, volume], mais recente primeiro
  return new Map(rows.map((r) => [r[0] * 1000, r[4]]));
}

/** Regime no fecho do dia `day` (abertura em ms). Por omissão, o último dia fechado. */
export async function fetchPremiumRegime(day?: number): Promise<PremiumRegime> {
  const [cb, btc] = await Promise.all([coinbaseDailyCloses(), fetchCandles('BTCUSDT', '1d', 200)]);
  const target = day ?? btc[btc.length - 1].timestamp;
  const prem: number[] = [];
  for (const c of btc) {
    if (c.timestamp > target) break;
    const x = cb.get(c.timestamp);
    if (x !== undefined && c.close > 0) prem.push(x / c.close - 1);
  }
  if (prem.length < 90) throw new Error(`prémio Coinbase: só ${prem.length} dias em comum`);
  if (btc.find((c) => c.timestamp === target) === undefined || !cb.has(target)) throw new Error('prémio Coinbase: falta o dia avaliado');
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const avg7 = avg(prem.slice(-7));
  const avg90 = avg(prem.slice(-90));
  return { day: target, on: avg7 > avg90, avg7: avg7 * 100, avg90: avg90 * 100, last: prem[prem.length - 1] * 100 };
}

export const PREMIUM_DAY_MS = DAY;
