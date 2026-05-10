'use client';

import { useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

const SCANNER_1_CODE = 'UNIVERSE_ABOVE_MA200_1H';
const SCANNER_2_CODE = 'UNIVERSE_NEAR_MA200_PCT10_1H';

interface ScanRow {
  symbol: string;
  close: number;
  ma: number;
  pctFromMa: number;
}

export default function UniversosMa200Page() {
  const [tab, setTab] = useState<'1' | '2'>('1');
  const [rows1, setRows1] = useState<ScanRow[]>([]);
  const [rows2, setRows2] = useState<ScanRow[]>([]);
  const [loading1, setLoading1] = useState(false);
  const [loading2, setLoading2] = useState(false);
  const [msg1, setMsg1] = useState('');
  const [msg2, setMsg2] = useState('');
  const [meta1, setMeta1] = useState<{ scannedAt?: string; count?: number }>({});
  const [meta2, setMeta2] = useState<{ scannedAt?: string; count?: number }>({});

  const runScan = async (which: '1' | '2') => {
    const code = which === '1' ? SCANNER_1_CODE : SCANNER_2_CODE;
    const setLoading = which === '1' ? setLoading1 : setLoading2;
    const setRows = which === '1' ? setRows1 : setRows2;
    const setMsg = which === '1' ? setMsg1 : setMsg2;
    const setMeta = which === '1' ? setMeta1 : setMeta2;

    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/symbol-universes/scan?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || data.details || 'Erro no scan');
        setRows([]);
        setMeta({});
        return;
      }
      setRows(data.rows || []);
      setMeta({ scannedAt: data.scannedAt, count: data.count });
    } catch {
      setMsg('Erro de rede ao executar scan');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(n);

  const rows = tab === '1' ? rows1 : rows2;
  const loading = tab === '1' ? loading1 : loading2;
  const msg = tab === '1' ? msg1 : msg2;
  const meta = tab === '1' ? meta1 : meta2;

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
          Universos MA200 (Binance Futures USDT)
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Scanner 1: fecho acima da SMA200 (1h). Scanner 2: afastamento absoluto face à SMA200 ≤ 10%.
          Universo candidato: até ~400 pares por volume 24h (mín. quote volume configurável na BD).
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={() => setTab('1')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              tab === '1'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
            }`}
          >
            Scanner 1 — Acima MA200
          </button>
          <button
            type="button"
            onClick={() => setTab('2')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              tab === '2'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
            }`}
          >
            Scanner 2 — ±10% da MA200
          </button>
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

        {meta.count !== undefined && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {meta.count} símbolo(s)
            {meta.scannedAt ? ` · ${new Date(meta.scannedAt).toLocaleString('pt-BR')}` : ''}
          </p>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="p-3 font-semibold text-gray-900 dark:text-white">Símbolo</th>
                <th className="p-3 font-semibold text-gray-900 dark:text-white">Fecho</th>
                <th className="p-3 font-semibold text-gray-900 dark:text-white">MA200</th>
                <th className="p-3 font-semibold text-gray-900 dark:text-white">Afast. %</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-500 dark:text-gray-400">
                    {loading
                      ? 'A carregar…'
                      : 'Sem dados. Clica em «Executar scan» (demora vários minutos).'}
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
