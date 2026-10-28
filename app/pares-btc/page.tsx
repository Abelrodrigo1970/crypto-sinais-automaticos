'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import type { BtcPair, BtcPairsResult } from '@/lib/btcPairs';

type SortKey = 'base' | 'ratio' | 'turnover24h' | 'chgUsdt24h' | 'chg24h' | 'chg7d' | 'chg30d' | 'fromHigh30d';

const COLS: Array<{ key: SortKey; label: string; title?: string }> = [
  { key: 'base', label: 'Par' },
  { key: 'ratio', label: 'Preço em BTC', title: 'Em satoshis (1 BTC = 100 000 000 sats)' },
  { key: 'turnover24h', label: 'Volume 24h' },
  { key: 'chgUsdt24h', label: '24h em USDT' },
  { key: 'chg24h', label: '24h vs BTC' },
  { key: 'chg7d', label: '7 dias vs BTC' },
  { key: 'chg30d', label: '30 dias vs BTC' },
  { key: 'fromHigh30d', label: 'Do máx. 30d', title: 'Distância do rácio ao máximo dos últimos 30 dias' },
];

const fmtPct = (v: number | null) =>
  v === null || !Number.isFinite(v) ? (
    <span className="text-gray-400">—</span>
  ) : (
    <span className={v > 0 ? 'text-green-600 dark:text-green-400' : v < 0 ? 'text-red-600 dark:text-red-400' : ''}>
      {v > 0 ? '+' : ''}
      {v.toFixed(2)}%
    </span>
  );

const fmtSats = (r: number) => {
  const s = r * 1e8;
  return s >= 100 ? Math.round(s).toLocaleString('pt-PT') : s >= 1 ? s.toFixed(2) : s.toPrecision(3);
};

const fmtVol = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)} mM` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} M` : `${(v / 1e3).toFixed(0)} k`);

const tvUrl = (p: BtcPair) =>
  `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BYBIT:${p.symbol}.P/BYBIT:BTCUSDT.P`)}`;

export default function ParesBtcPage() {
  const [data, setData] = useState<BtcPairsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [minVol, setMinVol] = useState(1_000_000);
  const [onlyReal, setOnlyReal] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'chg7d', dir: -1 });

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/btc-pairs${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.details || j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toUpperCase();
    return data.pairs
      .filter((p) => p.turnover24h >= minVol)
      .filter((p) => !term || p.base.includes(term))
      .filter((p) => !onlyReal || p.realPair.bybit || p.realPair.binance)
      .sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
  }, [data, q, minVol, onlyReal, sort]);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'base' ? 1 : -1 }));

  const stronger7d = rows.filter((p) => (p.chg7d ?? 0) > 0).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Pares BTC</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 max-w-3xl">
          Todas as moedas dos perpétuos USDT da Bybit cotadas contra o BTC (rácio moeda ÷ BTC). Positivo = a moeda está mais forte
          que o BTC no período. O link abre o gráfico do rácio no TradingView. A Bybit só tem 7 pares spot reais com BTC; os
          restantes são sintéticos, como no TradingView.
        </p>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">BTC</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white tabular-nums">
                {data.btcPrice.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} USDT {fmtPct(data.btcChg24h)}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Pares na lista</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white tabular-nums">
                {rows.length} <span className="text-sm font-normal text-gray-500">de {data.count}</span>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Mais fortes que o BTC (7 dias)</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white tabular-nums">
                {rows.length ? Math.round((stronger7d / rows.length) * 100) : 0}%
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Atualizado</div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {new Date(data.updatedAt).toLocaleString('pt-PT')}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            id="q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar moeda"
            className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            Volume 24h mínimo
            <select
              id="minVol"
              value={minVol}
              onChange={(e) => setMinVol(Number(e.target.value))}
              className="px-2 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value={0}>Todos</option>
              <option value={1_000_000}>1 M</option>
              <option value={10_000_000}>10 M</option>
              <option value={50_000_000}>50 M</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input id="onlyReal" type="checkbox" checked={onlyReal} onChange={(e) => setOnlyReal(e.target.checked)} />
            Só com par spot real em BTC
          </label>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="ml-auto px-3 py-2 rounded-md bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'A calcular…' : 'Atualizar'}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
            Não foi possível calcular os pares: {error}. Carrega em Atualizar para tentar de novo.
          </div>
        )}

        {!data && loading && (
          <p className="text-sm text-gray-600 dark:text-gray-400">A calcular os pares de todas as moedas (pode demorar até um minuto)…</p>
        )}

        {data && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  {COLS.map((c) => (
                    <th
                      key={c.key}
                      title={c.title}
                      onClick={() => onSort(c.key)}
                      className={`py-2 px-3 font-medium cursor-pointer select-none whitespace-nowrap ${c.key === 'base' ? '' : 'text-right'}`}
                    >
                      {c.label}
                      {sort.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                  <th className="py-2 px-3 font-medium">Par real</th>
                  <th className="py-2 px-3 font-medium">Gráfico</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.symbol} className="border-b border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="py-2 px-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">{p.base}/BTC</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-900 dark:text-gray-100">{fmtSats(p.ratio)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtVol(p.turnover24h)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtPct(p.chgUsdt24h)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtPct(p.chg24h)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtPct(p.chg7d)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtPct(p.chg30d)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtPct(p.fromHigh30d)}</td>
                    <td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {[p.realPair.bybit && 'Bybit', p.realPair.binance && 'Binance'].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <a href={tvUrl(p)} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                        TradingView
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}
