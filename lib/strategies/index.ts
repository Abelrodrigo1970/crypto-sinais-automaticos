import type { StrategyDefinition } from './types';

/**
 * Registo de estratégias. Cada estratégia nova é um ficheiro em lib/strategies/
 * que exporta um StrategyDefinition e é adicionado a esta lista.
 * Ao correr o motor, cada entrada é sincronizada com a tabela Strategy.
 */
export const STRATEGIES: StrategyDefinition<any>[] = [];

export function getStrategyDefinition(name: string): StrategyDefinition<any> | undefined {
  return STRATEGIES.find((s) => s.name === name);
}
