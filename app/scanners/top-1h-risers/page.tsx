'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface Row {
  symbol: string;
  changePercent1h: number;
  lastClose: number;
}

export default function Top1hRisersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [meta, setMeta] = useState<{
    fetchedAt?: string;
    candidatePool?: number;
    onlyRising?: boolean;
    note?: string;
  }>({});

  const load = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/scanners/top-1h-risers?limit=50&candidatePool=400');
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMsg(data.details || data.error || 'Erro ao carregar');
        setRows([]);
        setMeta({});
        return;
      }
      setRows(data.rows || []);
      setMeta({
        fetchedAt: data.fetchedAt,
        candidatePool: data.candidatePool,
        onlyRising: data.onlyRising,
        note: data.note,
      });
    } catch {
      setMsg('Erro de rede');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fmtPrice = (n: number) =>
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(n);
  const fmtPct = (n: number) =>
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n) + '%';

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
          Top 50 — a subir na última hora (1h)
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Perpétuos USDT (Binance Futures): compara o fecho da última vela <strong>1h</strong> fechada com a
          anterior. Lista as <strong>50</strong> maiores subidas % entre ~400 candidatos (ordem do{' '}
          <code className="text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">exchangeInfo</code>).
          Só aparecem pares com variação <strong>&gt; 0%</strong>.
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'A calcular…' : 'Atualizar lista'}
          </button>
        </div>

        {msg && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            {msg}
          </div>
        )}

        {(meta.fetchedAt || meta.note) && (
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-4 space-y-1">
            {meta.fetchedAt && (
              <p>
                Última atualização: {new Date(meta.fetchedAt).toLocaleString('pt-BR')}
                {meta.candidatePool != null && ` · candidatos: ${meta.candidatePool}`}
              </p>
            )}
            {meta.note && <p className="text-xs opacity-90 max-w-3xl">{meta.note}</p>}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600 text-left">
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">#</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Par</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Δ 1h</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Último fecho</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    Carrega a lista com o botão «Atualizar lista» (o pedido demora ~30–60 s por causa da
                    Binance).
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr
                  key={r.symbol}
                  className="border-b border-gray-100 dark:border-gray-700/80 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                >
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{r.symbol}</td>
                  <td className="px-4 py-2 text-green-700 dark:text-green-400 tabular-nums">
                    +{fmtPct(r.changePercent1h)}
                  </td>
                  <td className="px-4 py-2 text-gray-800 dark:text-gray-200 tabular-nums">
                    {fmtPrice(r.lastClose)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Disclaimer />
      </main>
    </div>
  );
}
