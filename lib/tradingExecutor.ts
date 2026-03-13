/**
 * Executor de sinais Volume Spike.
 * executeSignal() = simulação (logs).
 * executeSignalReal() = ordens reais na Binance (apenas Testnet quando TRADING_ENABLED).
 */

import {
  canExecuteSignal,
  getExecutionParams,
  roundQuantity,
  type SignalForTrading,
} from './tradingRules';
import {
  isTradingEnabled,
  hasTradingCredentials,
  isTestnet,
} from './binanceConfig';
import {
  createOrder,
  createAlgoOrder,
  getLotSizeStep,
} from './binanceFuturesClient';

export interface ExecuteResult {
  success: boolean;
  dryRun: boolean;
  message: string;
  params?: ReturnType<typeof getExecutionParams>;
  orderId?: number;
  stopOrderId?: number;
}

function toSignalForRules(signal: SignalForTrading): SignalForTrading {
  return {
    id: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    target1: signal.target1,
    target2: signal.target2,
    target3: signal.target3,
    strength: signal.strength,
    strategyName: signal.strategyName,
    status: signal.status,
  };
}

/**
 * Simulação: verifica regras, calcula params e faz LOG. NÃO cria ordens.
 */
export function executeSignal(signal: SignalForTrading): ExecuteResult {
  const check = canExecuteSignal(toSignalForRules(signal));
  if (!check.ok) {
    console.log(`[TradingExecutor] Sinal ${signal.id} rejeitado: ${check.reason}`);
    return {
      success: false,
      dryRun: true,
      message: check.reason ?? 'Sinal não executável',
    };
  }

  const params = getExecutionParams(toSignalForRules(signal));
  if (!params.canExecute || !params.positionSizeUsdt) {
    return {
      success: false,
      dryRun: true,
      message: 'Parâmetros inválidos',
    };
  }

  console.log('[TradingExecutor] ===== SIMULAÇÃO (dry run) =====');
  console.log(`[TradingExecutor] Sinal: ${signal.symbol} ${signal.direction} | Força ${signal.strength}`);
  console.log(`[TradingExecutor] Entrada: ${params.entryPrice} | Qty: ${params.quantity} | Posição: ${params.positionSizeUsdt} USDT`);
  console.log(`[TradingExecutor] Stop Loss: ${params.stopLoss}`);
  params.takeProfits.forEach((tp) => {
    console.log(`[TradingExecutor] ${tp.label} (${tp.percentOfPosition}%): ${tp.price}`);
  });
  console.log('[TradingExecutor] ================================');

  return {
    success: true,
    dryRun: true,
    message: `Simulação OK: ${params.symbol} ${params.direction} qty ${params.quantity}`,
    params,
  };
}

/**
 * Execução real: cria ordem MARKET (entrada) + STOP_MARKET (stop loss).
 * Só executa se TRADING_ENABLED=true e BINANCE_FUTURES_BASE_URL for Testnet.
 */
export async function executeSignalReal(signal: SignalForTrading): Promise<ExecuteResult> {
  const check = canExecuteSignal(toSignalForRules(signal));
  if (!check.ok) {
    return {
      success: false,
      dryRun: false,
      message: check.reason ?? 'Sinal não executável',
    };
  }

  if (!hasTradingCredentials()) {
    return {
      success: false,
      dryRun: false,
      message: 'Credenciais Binance não configuradas',
    };
  }

  if (!isTradingEnabled()) {
    return {
      success: false,
      dryRun: false,
      message: 'Trading desativado (TRADING_ENABLED=false)',
    };
  }

  if (!isTestnet()) {
    return {
      success: false,
      dryRun: false,
      message: 'Execução apenas permitida no Testnet. Configure BINANCE_FUTURES_BASE_URL para testnet.binancefuture.com',
    };
  }

  const params = getExecutionParams(toSignalForRules(signal));
  if (!params.canExecute) {
    return { success: false, dryRun: false, message: 'Parâmetros inválidos' };
  }

  try {
    const stepSize = await getLotSizeStep(signal.symbol);
    const qty = typeof params.quantity === 'number' ? params.quantity : 0;
    const step = Number.isFinite(stepSize) && stepSize > 0 ? stepSize : 0.001;
    const qtyStr = roundQuantity(qty, step);

    const entryOrder = await createOrder({
      symbol: signal.symbol,
      side: signal.direction,
      type: 'MARKET',
      quantity: qtyStr,
    });

    const slSide = signal.direction === 'BUY' ? 'SELL' : 'BUY';
    const stopOrder = await createAlgoOrder({
      symbol: signal.symbol,
      side: slSide,
      type: 'STOP_MARKET',
      triggerPrice: String(signal.stopLoss),
      closePosition: true,
    });

    console.log(`[TradingExecutor] Ordem entrada: ${entryOrder.orderId} | Stop Loss algo: ${stopOrder.algoId}`);

    return {
      success: true,
      dryRun: false,
      message: `Trade executado: ${signal.symbol} ${signal.direction} order ${entryOrder.orderId}`,
      params,
      orderId: entryOrder.orderId,
      stopOrderId: stopOrder.algoId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TradingExecutor] Erro ao executar:', msg);
    return {
      success: false,
      dryRun: false,
      message: `Erro Binance: ${msg}`,
    };
  }
}

/**
 * Verifica se o executor pode correr (credenciais, TRADING_ENABLED, Testnet).
 */
export function getExecutorStatus(): {
  hasCredentials: boolean;
  tradingEnabled: boolean;
  isTestnet: boolean;
  ready: boolean;
  reason?: string;
} {
  const hasCredentials = hasTradingCredentials();
  const tradingEnabled = isTradingEnabled();
  const testnet = isTestnet();
  let reason: string | undefined;
  if (!hasCredentials) reason = 'API Key/Secret não configurados';
  else if (!tradingEnabled) reason = 'TRADING_ENABLED=false';
  else if (!testnet) reason = 'Apenas Testnet permitido para execução';

  return {
    hasCredentials,
    tradingEnabled,
    isTestnet: testnet,
    ready: hasCredentials && tradingEnabled && testnet,
    reason,
  };
}
