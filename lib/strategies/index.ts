import type { StrategyDefinition } from './types';
import { ibs } from './ibs';
import { rma } from './rma';
import { rsi2 } from './rsi2';

/**
 * Registo de estratégias. Cada estratégia nova é um ficheiro em lib/strategies/
 * que exporta um StrategyDefinition e é adicionado a esta lista.
 * Ao correr o motor, cada entrada é sincronizada com a tabela Strategy.
 */
export const STRATEGIES: StrategyDefinition<any>[] = [rsi2, ibs, rma];

export function getStrategyDefinition(name: string): StrategyDefinition<any> | undefined {
  return STRATEGIES.find((s) => s.name === name);
}
