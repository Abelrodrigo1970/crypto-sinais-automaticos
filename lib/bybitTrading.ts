/**
 * Execução das posições na Bybit. Uma entrada só é enviada com as três chaves ligadas:
 * BYBIT_TRADING_ENABLED=true, interruptor global (TradingControl) e Strategy.tradingOn.
 * Desligar o interruptor bloqueia entradas novas; as posições já executadas continuam a ser
 * fechadas pela regra da estratégia (só exigem BYBIT_TRADING_ENABLED e credenciais).
 */

import type { Signal } from '@prisma/client';
import { prisma } from './db';
import {
  BybitError,
  getInstrumentRules,
  getOrderByLinkId,
  getPositionSize,
  getWallet,
  hasCredentials,
  isTestnet,
  placeIocOrder,
  setLeverage,
} from './bybitClient';

export function tradingConfig() {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(+v) ? +v : d);
  return {
    envEnabled: process.env.BYBIT_TRADING_ENABLED === 'true',
    hasCredentials: hasCredentials(),
    testnet: isTestnet(),
    positionPct: num(process.env.BYBIT_POSITION_PCT, 5),
    maxPositions: num(process.env.BYBIT_MAX_POSITIONS, 20),
    leverage: num(process.env.BYBIT_LEVERAGE, 1),
    maxSlippagePct: num(process.env.BYBIT_MAX_SLIPPAGE_PCT, 0.5),
  };
}

export async function getTradingSwitch(): Promise<boolean> {
  const row = await prisma.tradingControl.findUnique({ where: { id: 1 } });
  return row?.bybitTradingOn ?? false;
}

export async function setTradingSwitch(on: boolean): Promise<boolean> {
  const row = await prisma.tradingControl.upsert({
    where: { id: 1 },
    create: { id: 1, bybitTradingOn: on },
    update: { bybitTradingOn: on },
  });
  return row.bybitTradingOn;
}

/** Pode abrir posições novas para esta estratégia? */
export async function canOpen(strategyTradingOn: boolean): Promise<boolean> {
  const cfg = tradingConfig();
  return cfg.envEnabled && cfg.hasCredentials && strategyTradingOn && (await getTradingSwitch());
}

/** Pode enviar ordens de saída? */
export function canClose(): boolean {
  const cfg = tradingConfig();
  return cfg.envEnabled && cfg.hasCredentials;
}

const OPEN_EXEC = ['FILLED', 'PARTIAL'];

function roundDown(v: number, step: number): number {
  return Math.floor(v / step + 1e-9) * step;
}
function roundUp(v: number, step: number): number {
  return Math.ceil(v / step - 1e-9) * step;
}
function fmt(v: number, step: number): string {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return v.toFixed(decimals);
}

async function waitFill(symbol: string, linkId: string) {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 400 + i * 300));
    const o = await getOrderByLinkId(symbol, linkId);
    if (o && !['New', 'PartiallyFilled', 'Created', 'Untriggered'].includes(o.orderStatus)) return o;
  }
  return getOrderByLinkId(symbol, linkId);
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Aberturas em fila: o limite de posições e o saldo são verificados uma a uma
let openQueue: Promise<void> = Promise.resolve();

/** Abre na Bybit a posição de um sinal acabado de criar */
export function openPosition(sig: Signal): Promise<void> {
  const run = openQueue.then(() => openPositionNow(sig));
  openQueue = run.catch(() => undefined);
  return run;
}

async function openPositionNow(sig: Signal): Promise<void> {
  const cfg = tradingConfig();
  const skip = (reason: string) =>
    prisma.signal.update({ where: { id: sig.id }, data: { execStatus: 'SKIPPED', execError: reason } });

  const openCount = await prisma.signal.count({ where: { execStatus: { in: OPEN_EXEC } } });
  if (openCount >= cfg.maxPositions) {
    await skip(`Máximo de ${cfg.maxPositions} posições abertas na Bybit`);
    return;
  }

  const linkId = `${sig.id}-in`;
  try {
    const [wallet, rules] = await Promise.all([getWallet(), getInstrumentRules(sig.symbol)]);
    const leverage = Math.min(cfg.leverage, rules.maxLeverage);
    const notional = Math.min(
      (wallet.totalEquity * cfg.positionPct) / 100,
      wallet.totalAvailableBalance * leverage * 0.95
    );
    const limit = roundUp(sig.entryPrice * (1 + cfg.maxSlippagePct / 100), rules.tickSize);
    const qty = Math.min(roundDown(notional / sig.entryPrice, rules.qtyStep), roundDown(rules.maxMktOrderQty, rules.qtyStep));
    if (qty < rules.minOrderQty || qty * sig.entryPrice < rules.minNotional) {
      await skip(`Posição de ${notional.toFixed(2)} USDT abaixo do mínimo da Bybit (${rules.minOrderQty} unid. / ${rules.minNotional} USDT)`);
      return;
    }

    await setLeverage(sig.symbol, leverage);
    await placeIocOrder({
      symbol: sig.symbol,
      side: sig.direction === 'BUY' ? 'Buy' : 'Sell',
      qty: fmt(qty, rules.qtyStep),
      price: fmt(limit, rules.tickSize),
      reduceOnly: false,
      orderLinkId: linkId,
    });
    const fill = await waitFill(sig.symbol, linkId);
    if (!fill || fill.cumExecQty <= 0) {
      await prisma.signal.update({
        where: { id: sig.id },
        data: { execStatus: 'FAILED', execError: `Não executou até ${fmt(limit, rules.tickSize)} (slippage máx. ${cfg.maxSlippagePct}%)` },
      });
      return;
    }
    await prisma.signal.update({
      where: { id: sig.id },
      data: {
        execStatus: fill.cumExecQty < qty - rules.qtyStep / 2 ? 'PARTIAL' : 'FILLED',
        execQty: fill.cumExecQty,
        execEntryPrice: fill.avgPrice,
        execError: null,
      },
    });
  } catch (error) {
    // A ordem pode ter chegado à Bybit mesmo com erro de rede: confirmar pelo orderLinkId
    let fill = null;
    try {
      fill = await getOrderByLinkId(sig.symbol, linkId);
    } catch {
      /* sem confirmação */
    }
    await prisma.signal.update({
      where: { id: sig.id },
      data:
        fill && fill.cumExecQty > 0
          ? { execStatus: 'FILLED', execQty: fill.cumExecQty, execEntryPrice: fill.avgPrice, execError: null }
          : { execStatus: 'FAILED', execError: errText(error) },
    });
  }
}

/** Fecha (ou continua a fechar) na Bybit a posição de um sinal que saiu pela regra da estratégia */
export async function closePosition(sig: Signal, price: number): Promise<void> {
  if (!sig.execQty || !sig.execEntryPrice) return;
  const cfg = tradingConfig();
  const attempt = sig.execExitAttempts + 1;
  const linkId = `${sig.id}-o${attempt}`;
  const done = sig.execExitQty ?? 0;
  try {
    const rules = await getInstrumentRules(sig.symbol);
    const held = await getPositionSize(sig.symbol);
    const remaining = Math.min(roundDown(sig.execQty - done, rules.qtyStep), held);
    if (remaining <= 0) {
      await prisma.signal.update({
        where: { id: sig.id },
        data: { execStatus: 'CLOSED', execError: done > 0 ? null : 'Posição já não existia na Bybit (fechada manualmente?)' },
      });
      return;
    }
    const sell = sig.direction === 'BUY';
    const limit = sell
      ? roundDown(price * (1 - cfg.maxSlippagePct / 100), rules.tickSize)
      : roundUp(price * (1 + cfg.maxSlippagePct / 100), rules.tickSize);
    await placeIocOrder({
      symbol: sig.symbol,
      side: sell ? 'Sell' : 'Buy',
      qty: fmt(remaining, rules.qtyStep),
      price: fmt(limit, rules.tickSize),
      reduceOnly: true,
      orderLinkId: linkId,
    });
    const fill = await waitFill(sig.symbol, linkId);
    const filled = fill?.cumExecQty ?? 0;
    const totalExit = done + filled;
    // preço médio de saída ponderado entre tentativas
    const exitPrice =
      filled > 0 ? ((sig.execExitPrice ?? 0) * done + fill!.avgPrice * filled) / totalExit : sig.execExitPrice;
    const closed = totalExit >= sig.execQty - rules.qtyStep / 2;
    await prisma.signal.update({
      where: { id: sig.id },
      data: {
        execExitAttempts: attempt,
        execExitQty: totalExit,
        execExitPrice: exitPrice,
        execStatus: closed ? 'CLOSED' : filled > 0 ? 'EXIT_PARTIAL' : 'EXIT_FAILED',
        execResultPct:
          closed && exitPrice
            ? ((exitPrice - sig.execEntryPrice) / sig.execEntryPrice) * 100 * (sell ? 1 : -1)
            : null,
        execError: closed ? null : `Saída por executar: ${fmt(sig.execQty - totalExit, rules.qtyStep)} unid. (repete na próxima corrida)`,
      },
    });
  } catch (error) {
    await prisma.signal.update({
      where: { id: sig.id },
      data: {
        execExitAttempts: attempt,
        execStatus: 'EXIT_FAILED',
        execError: `${errText(error)} (repete na próxima corrida)`,
      },
    });
    if (error instanceof BybitError) console.error(`[bybit] saída ${sig.symbol}:`, error.message);
  }
}

export const EXIT_RETRY_STATUSES = ['EXIT_FAILED', 'EXIT_PARTIAL'];
