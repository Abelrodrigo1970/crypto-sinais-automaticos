/**
 * Cliente autenticado da API Bybit v5 (perpétuos lineares USDT, conta Unified).
 * Credenciais e limites vêm de variáveis de ambiente; nada aqui decide se se negoceia
 * (isso é lib/bybitTrading.ts).
 */

import crypto from 'crypto';

const RECV_WINDOW = '10000';

export function isTestnet(): boolean {
  return process.env.BYBIT_TESTNET === 'true';
}

function baseUrl(): string {
  if (process.env.BYBIT_API_BASE_URL) return process.env.BYBIT_API_BASE_URL; // testes contra servidor simulado
  return isTestnet() ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
}

export function hasCredentials(): boolean {
  return !!process.env.BYBIT_API_KEY && !!process.env.BYBIT_API_SECRET;
}

export class BybitError extends Error {
  constructor(public retCode: number, message: string, public path: string) {
    super(`Bybit ${retCode}: ${message} (${path})`);
  }
}

async function signedRequest<T>(method: 'GET' | 'POST', path: string, params: Record<string, unknown>): Promise<T> {
  const key = process.env.BYBIT_API_KEY;
  const secret = process.env.BYBIT_API_SECRET;
  if (!key || !secret) throw new Error('BYBIT_API_KEY / BYBIT_API_SECRET não configurados');

  const timestamp = Date.now().toString();
  const query =
    method === 'GET'
      ? Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
  const body = method === 'POST' ? JSON.stringify(params) : '';
  const sign = crypto
    .createHmac('sha256', secret)
    .update(timestamp + key + RECV_WINDOW + (method === 'GET' ? query : body))
    .digest('hex');

  const response = await fetch(`${baseUrl()}${path}${query ? `?${query}` : ''}`, {
    method,
    cache: 'no-store',
    headers: {
      'X-BAPI-API-KEY': key,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': sign,
      'Content-Type': 'application/json',
    },
    body: body || undefined,
  });
  if (!response.ok) throw new Error(`Bybit HTTP ${response.status} em ${path}`);
  const data = await response.json();
  if (data.retCode !== 0) throw new BybitError(data.retCode, data.retMsg, path);
  return data.result as T;
}

async function publicGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const response = await fetch(`${baseUrl()}${path}?${qs}`, { cache: 'no-store' });
  const data = await response.json();
  if (data.retCode !== 0) throw new BybitError(data.retCode, data.retMsg, path);
  return data.result as T;
}

export interface WalletSummary {
  totalEquity: number;
  totalAvailableBalance: number;
}

export async function getWallet(): Promise<WalletSummary> {
  const r = await signedRequest<{ list: Array<{ totalEquity: string; totalAvailableBalance: string }> }>(
    'GET',
    '/v5/account/wallet-balance',
    { accountType: 'UNIFIED' }
  );
  const acc = r.list[0];
  return { totalEquity: parseFloat(acc.totalEquity), totalAvailableBalance: parseFloat(acc.totalAvailableBalance) };
}

export interface InstrumentRules {
  qtyStep: number;
  minOrderQty: number;
  maxMktOrderQty: number;
  minNotional: number;
  tickSize: number;
  maxLeverage: number;
}

const rulesCache = new Map<string, InstrumentRules>();

export async function getInstrumentRules(symbol: string): Promise<InstrumentRules> {
  const cached = rulesCache.get(symbol);
  if (cached) return cached;
  const r = await publicGet<{ list: any[] }>('/v5/market/instruments-info', { category: 'linear', symbol });
  const i = r.list[0];
  if (!i) throw new Error(`Instrumento ${symbol} não existe na Bybit${isTestnet() ? ' testnet' : ''}`);
  const rules: InstrumentRules = {
    qtyStep: parseFloat(i.lotSizeFilter.qtyStep),
    minOrderQty: parseFloat(i.lotSizeFilter.minOrderQty),
    maxMktOrderQty: parseFloat(i.lotSizeFilter.maxMktOrderQty ?? i.lotSizeFilter.maxOrderQty),
    minNotional: parseFloat(i.lotSizeFilter.minNotionalValue ?? '0'),
    tickSize: parseFloat(i.priceFilter.tickSize),
    maxLeverage: parseFloat(i.leverageFilter.maxLeverage),
  };
  rulesCache.set(symbol, rules);
  return rules;
}

/** Define a alavancagem (ignora "leverage not modified") */
export async function setLeverage(symbol: string, leverage: number): Promise<void> {
  try {
    await signedRequest('POST', '/v5/position/set-leverage', {
      category: 'linear',
      symbol,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage),
    });
  } catch (error) {
    if (error instanceof BybitError && error.retCode === 110043) return;
    throw error;
  }
}

export interface PlaceOrderInput {
  symbol: string;
  side: 'Buy' | 'Sell';
  qty: string;
  /** Preço limite (IOC): compra até este preço, venda a partir dele */
  price: string;
  reduceOnly: boolean;
  /** Idempotência: a Bybit rejeita um segundo orderLinkId igual */
  orderLinkId: string;
}

export async function placeIocOrder(input: PlaceOrderInput): Promise<{ orderId: string }> {
  return signedRequest('POST', '/v5/order/create', {
    category: 'linear',
    symbol: input.symbol,
    side: input.side,
    orderType: 'Limit',
    timeInForce: 'IOC',
    qty: input.qty,
    price: input.price,
    reduceOnly: input.reduceOnly,
    positionIdx: 0,
    orderLinkId: input.orderLinkId,
  });
}

export interface OrderFill {
  orderId: string;
  orderStatus: string;
  cumExecQty: number;
  avgPrice: number;
}

/** Estado de uma ordem pelo orderLinkId (ativa ou já no histórico) */
export async function getOrderByLinkId(symbol: string, orderLinkId: string): Promise<OrderFill | null> {
  for (const path of ['/v5/order/realtime', '/v5/order/history']) {
    const r = await signedRequest<{ list: any[] }>('GET', path, { category: 'linear', symbol, orderLinkId });
    const o = r.list?.[0];
    if (o) {
      return {
        orderId: o.orderId,
        orderStatus: o.orderStatus,
        cumExecQty: parseFloat(o.cumExecQty || '0'),
        avgPrice: parseFloat(o.avgPrice || '0'),
      };
    }
  }
  return null;
}

/** Tamanho da posição aberta (modo one-way) */
export async function getPositionSize(symbol: string): Promise<number> {
  const r = await signedRequest<{ list: Array<{ size: string }> }>('GET', '/v5/position/list', { category: 'linear', symbol });
  return r.list.reduce((s, p) => s + parseFloat(p.size || '0'), 0);
}
