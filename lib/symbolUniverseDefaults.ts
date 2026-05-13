/**
 * Definições dos scanners de universo quando a BD ainda não tem SymbolUniverse
 * (ou registo em falta). Scanner 1: MA200; scanners 2–3: afastamento % à SMA80. Deve coincidir com o seed.
 */

import type { UniverseScanDefinition } from './universeScanner';

/**
 * Scanner 2 na página Universos: |preço − SMA80| / SMA80 × 100 ≤ 10% (velas 1h).
 * O identificador mantém-se por compatibilidade com a BD (`UniverseScanRun.universeCode`).
 * Estratégias **Afastamento médio** (1h e 30m) usam o último scan gravado com este código.
 */
export const UNIVERSE_CODE_AFASTAMENTO_SCANNER_MA80 =
  'UNIVERSE_NEAR_MA200_PCT10_1H' as const;

/** Scanner 3 na página Universos: |preço − SMA80| / SMA80 × 100 ≤ 4% (velas 1h). */
export const UNIVERSE_CODE_SCANNER_3_MA80_PCT4 =
  'UNIVERSE_NEAR_MA200_PCT4_1H' as const;

export const BUILTIN_UNIVERSE_SCAN: Record<string, UniverseScanDefinition> = {
  UNIVERSE_ABOVE_MA200_1H: {
    ruleType: 'ABOVE_MA',
    maPeriod: 200,
    maxDistancePct: null,
    timeframe: '1h',
    minQuoteVolume: 100000,
    candidateLimit: 400,
  },
  UNIVERSE_NEAR_MA200_PCT10_1H: {
    ruleType: 'WITHIN_PCT_OF_MA',
    maPeriod: 80,
    maxDistancePct: 10,
    timeframe: '1h',
    minQuoteVolume: 100000,
    candidateLimit: 400,
  },
  UNIVERSE_NEAR_MA200_PCT4_1H: {
    ruleType: 'WITHIN_PCT_OF_MA',
    maPeriod: 80,
    maxDistancePct: 4,
    timeframe: '1h',
    minQuoteVolume: 100000,
    candidateLimit: 400,
  },
};

export const BUILTIN_UNIVERSE_META: Record<
  string,
  { code: string; displayName: string; description: string }
> = {
  UNIVERSE_ABOVE_MA200_1H: {
    code: 'UNIVERSE_ABOVE_MA200_1H',
    displayName: 'Scanner 1 — Acima da MA200 (1h)',
    description:
      'Perpétuos USDT (top volume) com fecho acima da SMA200 em 1h.',
  },
  UNIVERSE_NEAR_MA200_PCT10_1H: {
    code: 'UNIVERSE_NEAR_MA200_PCT10_1H',
    displayName: 'Scanner 2 — Até ±10% da MA80 (1h)',
    description:
      'Preço dentro de ±10% da SMA80 em 1h (|afastamento| à MA80 ≤ 10%).',
  },
  UNIVERSE_NEAR_MA200_PCT4_1H: {
    code: 'UNIVERSE_NEAR_MA200_PCT4_1H',
    displayName: 'Scanner 3 — Até ±4% da MA80 (1h)',
    description:
      'Preço dentro de ±4% da SMA80 em 1h (|afastamento| à MA80 ≤ 4%).',
  },
};

export function getBuiltinScanDefinition(code: string): UniverseScanDefinition | null {
  return BUILTIN_UNIVERSE_SCAN[code] ?? null;
}

/** Lista para API quando a BD não tem linhas (id null = não associável a Strategy até seed). */
export function listBuiltinUniversesForApi(): Array<{
  id: string | null;
  code: string;
  displayName: string;
  description: string;
  ruleType: string;
  maPeriod: number;
  maxDistancePct: number | null;
  timeframe: string;
  minQuoteVolume: number;
  candidateLimit: number;
  createdAt: string;
  updatedAt: string;
}> {
  return Object.keys(BUILTIN_UNIVERSE_META).map((code) => {
    const m = BUILTIN_UNIVERSE_META[code];
    const s = BUILTIN_UNIVERSE_SCAN[code];
    return {
      id: null,
      code: m.code,
      displayName: `${m.displayName} (corre seed para associar)`,
      description: m.description,
      ruleType: s.ruleType,
      maPeriod: s.maPeriod,
      maxDistancePct: s.maxDistancePct,
      timeframe: s.timeframe,
      minQuoteVolume: s.minQuoteVolume,
      candidateLimit: s.candidateLimit,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
  });
}
