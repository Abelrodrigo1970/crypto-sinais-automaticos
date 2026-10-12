'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface Row {
  rank: number;
  symbol: string;
  price: number;
  high6m: number;
  high6mAt: string;
  low6m: number;
  low6mAt: string;
  rangePct: number;
  pctFromHigh: number;
  pctFromLow: number;
  avgClose6m: number;
  pctFromAvg: number;
  midRange: number;
  rangePositionPct: number;
  quoteVolume24h: number;
  tradingViewUrl: string;
}

type SortKey =
  | 'rank'
  | 'symbol'
  | 'price'
  | 'rangePct'
  | 'high6m'
  | 'pctFromHigh'
  | 'low6m'
  | 'pctFromLow'
  | 'avgClose6m'
  | 'pctFromAvg'
  | 'rangePositionPct'
  | 'quoteVolume24h';

const fmtPrice = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(n);

const fmtPct = (n: number, decimals = 1) =>
  `${n >= 0 ? '+' : ''}${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)}%`;

const fmtVolume = (v: number) => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${(v / 1e3).toFixed(0)}k`;
};

const fmtDate = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
};

const pctClass = (n: number) =>
  n >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400';

export default function Range6mPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [meta, setMeta] = useState<{ fetchedAt?: string; candidates?: number }>({});
  const [sortKey, setSortKey] = useState<SortKey>('rangePct');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/scanners/range-6m?limit=30');
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMsg(data.details || data.error || 'Erro ao carregar');
        setRows([]);
        setMeta({});
        return;
      }
      setRows(data.rows || []);
      setMeta({ fetchedAt: data.fetchedAt, candidates: data.candidates });
    } catch {
      setMsg('Erro de rede');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => {
    const q = filter.trim().toUpperCase();
    const list = q ? rows.filter((r) => r.symbol.includes(q)) : [...rows];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [rows, filter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === 'symbol' || key === 'rank');
    }
  };

  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th
      className={`px-3 py-3 font-semibold text-gray-700 dark:text-gray-200 cursor-pointer select-none hover:text-blue-600 whitespace-nowrap ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => toggleSort(key)}
    >
      {label}
      {sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link href="/scanners" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← Scanners
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Top 30 — maior amplitude 6 meses
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4 max-w-4xl">
          Perpétuos USDT (Binance Futures) com a maior diferença entre a <strong>máxima</strong> e a{' '}
          <strong>mínima</strong> dos últimos <strong>6 meses</strong> (velas 1d, inclui o dia actual).
          Amplitude = máxima ÷ mínima − 1. Só entram pares com volume 24h ≥ <strong>$1M</strong> e ~6 meses
          de histórico. <strong>Média 6m</strong> = média dos fechos diários; <strong>Posição</strong> =
          onde está o preço entre a mínima (0%) e a máxima (100%).
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'A calcular… (~30–60 s)' : 'Atualizar lista'}
          </button>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar par…"
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          {meta.fetchedAt && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Última atualização: {new Date(meta.fetchedAt).toLocaleString('pt-BR')}
              {meta.candidates != null && ` · ${meta.candidates} pares analisados`}
            </span>
          )}
        </div>

        {msg && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            {msg}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600">
                {th('rank', '#', 'left')}
                {th('symbol', 'Par', 'left')}
                {th('price', 'Preço actual')}
                {th('rangePct', 'Amplitude')}
                {th('high6m', 'Máx. 6m')}
                {th('pctFromHigh', 'Dif. máx.')}
                {th('low6m', 'Mín. 6m')}
                {th('pctFromLow', 'Dif. mín.')}
                {th('avgClose6m', 'Média 6m')}
                {th('pctFromAvg', 'Dif. média')}
                {th('rangePositionPct', 'Posição')}
                {th('quoteVolume24h', 'Vol 24h')}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    {loading
                      ? 'A calcular (velas 1d de todos os pares; demora ~30–60 s)…'
                      : 'Sem dados. Carrega em «Atualizar lista».'}
                  </td>
                </tr>
              )}
              {sorted.map((r) => (
                <tr
                  key={r.symbol}
                  className="border-b border-gray-100 dark:border-gray-700/80 hover:bg-gray-50 dark:hover:bg-gray-700/40 tabular-nums"
                >
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{r.rank}</td>
                  <td className="px-3 py-2 font-medium">
                    <a
                      href={r.tradingViewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {r.symbol}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{fmtPrice(r.price)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-blue-700 dark:text-blue-300">
                    {fmtPct(r.rangePct, 0)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200">
                    {fmtPrice(r.high6m)}
                    <div className="text-[11px] text-gray-400">{fmtDate(r.high6mAt)}</div>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${pctClass(r.pctFromHigh)}`}>
                    {fmtPct(r.pctFromHigh)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200">
                    {fmtPrice(r.low6m)}
                    <div className="text-[11px] text-gray-400">{fmtDate(r.low6mAt)}</div>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${pctClass(r.pctFromLow)}`}>
                    {fmtPct(r.pctFromLow)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200">{fmtPrice(r.avgClose6m)}</td>
                  <td className={`px-3 py-2 text-right ${pctClass(r.pctFromAvg)}`}>{fmtPct(r.pctFromAvg)}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full bg-blue-500"
                          style={{ width: `${Math.min(100, Math.max(0, r.rangePositionPct))}%` }}
                        />
                      </div>
                      <span className="w-10 text-right">{r.rangePositionPct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">
                    {fmtVolume(r.quoteVolume24h)}
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
