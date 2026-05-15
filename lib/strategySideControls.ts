/** Lados ativos em `Strategy.params` (ex.: Afastamento 30m). Omitido ou true = ativo. */
export function parseStrategyParamsJson(paramsJson: string | null | undefined): Record<string, unknown> {
  if (!paramsJson || paramsJson.trim() === '') return {};
  try {
    const parsed = JSON.parse(paramsJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function isParamTruthy(value: unknown, defaultWhenMissing = true): boolean {
  if (value === undefined || value === null) return defaultWhenMissing;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return true;
}

export function isBuySideEnabled(params: Record<string, unknown>): boolean {
  return isParamTruthy(params.buyEnabled);
}

export function isSellSideEnabled(params: Record<string, unknown>): boolean {
  return isParamTruthy(params.sellEnabled);
}

export function isDirectionEnabledForStrategy(
  strategyName: string | null | undefined,
  paramsJson: string | null | undefined,
  direction: 'BUY' | 'SELL'
): boolean {
  if (strategyName !== 'AFASTAMENTO_MEDIO_30M') return true;
  const params = parseStrategyParamsJson(paramsJson);
  return direction === 'BUY' ? isBuySideEnabled(params) : isSellSideEnabled(params);
}
