'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

type TabId = '1' | '2' | '3';

const SCANNER_CODE: Record<TabId, string> = {
  '1': 'UNIVERSE_ABOVE_MA200_1H',
  '2': 'UNIVERSE_NEAR_MA200_PCT10_1H',
  '3': 'UNIVERSE_NEAR_MA200_PCT4_1H',
};

const SCANNER_LABEL: Record<TabId, string> = {
  '1': 'Scanner 1 — Acima MA200',
  '2': 'Scanner 2 — ±10% da MA80',
  '3': 'Scanner 3 — ±4% da MA80',
};

interface ScanRow {
  symbol: string;
  close: number;
  ma: number;
  pctFromMa: number;
}

interface PanelMeta {
  scannedAt?: string;
  count?: number;
  persistLine?: string;
}

interface PanelState {
  rows: ScanRow[];
  loading: boolean;
  msg: string;
  meta: PanelMeta;
}

const emptyPanel = (): PanelState => ({
  rows: [],
  loading: false,
  msg: '',
  meta: {},
});

export default function UniversosMa200Page() {
  const [tab, setTab] = useState<TabId>('1');
  const [panels, setPanels] = useState<Record<TabId, PanelState>>({
    '1': emptyPanel(),
    '2': emptyPanel(),
    '3': emptyPanel(),
  });
  const [bootstrapping, setBootstrapping] = useState(true);

  const fetchLastPersisted = useCallback(async (t: TabId) => {
    const code = SCANNER_CODE[t];
    setPanels((p) => ({ ...p, [t]: { ...p[t], msg: '' } }));
    try {
      const res = await fetch(`/api/symbol-universes/last-scan?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        setPanels((prev) => ({
          ...prev,
          [t]: { ...prev[t], msg: data.error || 'Erro ao carregar último scan', rows: [], meta: {} },
        }));
        return;
      }
      if (data.unavailable && data.note) {
        setPanels((prev) => ({
          ...prev,
          [t]: {
            ...prev[t],
            rows: [],
            meta: { count: 0, persistLine: data.note },
          },
        }));
        return;
      }
      const rows = data.rows || [];
      if (data.found && data.scannedAt) {
        setPanels((prev) => ({
          ...prev,
          [t]: {
            ...prev[t],
            rows,
            meta: {
              scannedAt: data.scannedAt,
              count: data.count ?? rows.length,
              persistLine: 'Dados do último scan gravado. Usa o botão verde para atualizar.',
            },
          },
        }));
      } else {
        setPanels((prev) => ({ ...prev, [t]: { ...prev[t], rows, meta: {} } }));
      }
    } catch {
      setPanels((prev) => ({
        ...prev,
        [t]: { ...prev[t], msg: 'Erro de rede ao carregar último scan' },
      }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([fetchLastPersisted('1'), fetchLastPersisted('2'), fetchLastPersisted('3')]);
      if (!cancelled) setBootstrapping(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchLastPersisted]);

  const runScan = async (t: TabId) => {
    const code = SCANNER_CODE[t];
    setPanels((p) => ({ ...p, [t]: { ...p[t], loading: true, msg: '' } }));
    try {
      const res = await fetch(`/api/symbol-universes/scan?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        const parts = [
          data.error || 'Erro no scan',
          data.details && String(data.details),
          data.hint && String(data.hint),
        ].filter(Boolean);
        setPanels((prev) => ({
          ...prev,
          [t]: {
            ...prev[t],
            loading: false,
            msg: parts.join(' — '),
            rows: [],
            meta: {},
          },
        }));
        return;
      }
      const rows = data.rows || [];
      let persistLine: string | undefined;
      if (data.persisted === true && data.persistedRunId) {
        persistLine = `Gravado na BD (execução ${data.persistedRunId.slice(0, 8)}…).`;
      } else if (data.persistError) {
        persistLine = `Não foi possível gravar na BD: ${String(data.persistError)}`;
      }
      setPanels((prev) => ({
        ...prev,
        [t]: {
          ...prev[t],
          loading: false,
          rows,
          meta: {
            scannedAt: data.scannedAt,
            count: data.count,
            persistLine: persistLine ?? 'Scan concluído.',
          },
        },
      }));
    } catch {
      setPanels((prev) => ({
        ...prev,
        [t]: { ...prev[t], loading: false, msg: 'Erro de rede ao executar scan', rows: [] },
      }));
    }
  };

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(n);

  const active = panels[tab];
  const { rows, loading, msg, meta } = active;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            href="/scanners"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Scanners
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Universos MA200 / MA80 (Binance Futures USDT)
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Scanner 1: fecho acima da SMA200 (1h). Scanner 2: |afastamento| à SMA80 ≤ 10%. Scanner 3: |afastamento| à
          SMA80 ≤ 4%. Universo candidato: até ~400 pares por volume 24h. A tabela carrega o último scan gravado; o
          Scanner 2 também é atualizado quando corre o cron com a estratégia Afastamento médio (universo Scanner 2). Os
          scanners 1 e 3 atualizam ao clicares em «Executar scan» neste separador.
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          {(['1', '2', '3'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                tab === id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
              }`}
            >
              {SCANNER_LABEL[id]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => runScan(tab)}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'A escanear…' : 'Executar scan deste separador'}
          </button>
        </div>

        {msg && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            {msg}
          </div>
        )}

        {(meta.count !== undefined || meta.scannedAt || meta.persistLine) && (
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-4 space-y-1">
            {meta.count !== undefined && (
              <p>
                {meta.count} símbolo(s)
                {meta.scannedAt ? ` · ${new Date(meta.scannedAt).toLocaleString('pt-BR')}` : ''}
              </p>
            )}
            {meta.persistLine && (
              <p
                className={
                  meta.persistLine.startsWith('Gravado')
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-amber-700 dark:text-amber-300'
                }
              >
                {meta.persistLine}
              </p>
            )}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="p-3 font-semibold text-gray-900 dark:text-white">Símbolo</th>
                <th className="p-3 font-semibold text-gray-900 dark:text-white">Fecho</th>
                <th className="p-3 font-semibold text-gray-900 dark:text-white">
                  {tab === '1' ? 'MA200' : 'MA80'}
                </th>
                <th className="p-3 font-semibold text-gray-900 dark:text-white">Afast. %</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-500 dark:text-gray-400">
                    {loading || bootstrapping
                      ? 'A carregar…'
                      : 'Sem dados gravados ainda. Clica em «Executar scan» para gerar a lista (demora vários minutos).'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.symbol}
                    className="border-b border-gray-100 dark:border-gray-700/80 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    <td className="p-3 font-medium text-gray-900 dark:text-white">{r.symbol}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-300">{formatPrice(r.close)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-300">{formatPrice(r.ma)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-300">
                      {r.pctFromMa.toFixed(2)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Disclaimer />
      </main>
    </div>
  );
}
