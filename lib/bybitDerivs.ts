/**
 * Séries horárias de derivados da Bybit (API pública v5): fecho do perpétuo, índice de prémio e open interest.
 * Alinhadas pela abertura da vela de 1h; só velas já fechadas.
 */
import type { HourRow } from './strategies/delevCalc';

const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const HOUR = 3_600_000;

async function get(path: string): Promise<any[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BYBIT_BASE_URL}${path}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Bybit HTTP ${res.status} em ${path}`);
      const j = await res.json();
      if (j.retCode !== 0) throw new Error(`Bybit ${j.retCode}: ${j.retMsg} (${path})`);
      return j.result?.list ?? [];
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Erro Bybit em ${path}`);
}

/** Últimas `hours` velas de 1h (fecho do perpétuo + fecho do índice de prémio + OI), mais antiga primeiro */
export async function fetchHourlyDerivs(symbol: string, hours = 1000): Promise<HourRow[]> {
  const [kl, pk] = await Promise.all([
    get(`/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=${Math.min(hours, 1000)}`),
    get(`/v5/market/premium-index-price-kline?category=linear&symbol=${symbol}&interval=60&limit=${Math.min(hours, 1000)}`),
  ]);
  const oi = new Map<number, number>();
  let end: number | undefined;
  for (let page = 0; page < Math.ceil(hours / 200) + 1 && oi.size < hours; page++) {
    const list = await get(
      `/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=1h&limit=200${end ? `&endTime=${end}` : ''}`
    );
    if (!list.length) break;
    let minTs = Infinity;
    for (const x of list) {
      const ts = Number(x.timestamp);
      oi.set(ts, parseFloat(x.openInterest));
      minTs = Math.min(minTs, ts);
    }
    end = minTs - 1;
  }
  const close = new Map<number, number>(kl.map((x: string[]) => [Number(x[0]), parseFloat(x[4])]));
  const prem = new Map<number, number>(pk.map((x: string[]) => [Number(x[0]), parseFloat(x[4])]));
  const now = Date.now();
  return Array.from(close.keys())
    .filter((t) => t + HOUR <= now && prem.has(t) && oi.has(t))
    .sort((a, b) => a - b)
    .map((t) => ({ t, c: close.get(t)!, pr: prem.get(t)!, oi: oi.get(t)! }));
}
