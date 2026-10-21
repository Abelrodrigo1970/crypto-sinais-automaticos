import type { AnyStrategyDefinition } from './types';
import { ibs } from './ibs';
import { rma } from './rma';
import { rsi2 } from './rsi2';
import { resMom } from './resMom';
import { pullback } from './pullback';
import { delev } from './delev';
import { scanner10 } from './scanner10';

/**
 * Registo de estratégias. Cada estratégia nova é um ficheiro em lib/strategies/
 * que exporta um StrategyDefinition e é adicionado a esta lista.
 * Ao correr o motor, cada entrada é sincronizada com a tabela Strategy.
 */
export const STRATEGIES: AnyStrategyDefinition[] = [rsi2, ibs, rma, resMom, pullback, delev, scanner10];

export function getStrategyDefinition(name: string): AnyStrategyDefinition | undefined {
  return STRATEGIES.find((s) => s.name === name);
}
