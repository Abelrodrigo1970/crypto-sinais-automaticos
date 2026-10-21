'use client';

import { useEffect, useState } from 'react';

type Stat = { n: number; mean: number; median: number; winRate: number; sum: number; best: number; worst: number } | null;
type Trade = {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  entryPrice: number;
  exitPrice: number | null;
  resultPct: number | null;
  weightPct: number;
  hours: number;
  exitReason: string | null;
  execStatus: string | null;
  execResultPct: number | null;
};
type Row = {
  name: string;
  signals: number;
  days: number;
  closed: Stat;
  open: Stat;
  all: Stat;
  capitalClosedPct: number;
  capitalOpenPct: number;
  capitalTotalPct: number;
  medianHoursClosed: number | null;
  executed: Stat;
  trades: Trade[];
};

const pct = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
const tone = (v: number | null | undefined) =>
  v == null ? 'text-gray-500' : v > 0 ? 'text-green-600 dark:text-green-400' : v < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300';
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const fmtHours = (h: number | null) => (h == null ? '—' : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`);

/** Aviso honesto sobre a quantidade de dados */
function verdict(r: Row): { text: string; cls: string } {
  const n = r.all?.n ?? 0;
  if (n < 30 || r.days < 10)
    return { text: `Amostra pequena (${n} trades em ${r.days} dia${r.days === 1 ? '' : 's'}) — ainda não dá para concluir`, cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' };
  if ((r.all?.mean ?? 0) > 0) return { text: 'Positiva no período', cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' };
  return { text: 'Negativa no período', cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' };
}

export default function StrategyPerformance({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pricesAt, setPricesAt] = useState('');
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    setLoading(true);
    fetch(`/api/strategy-performance?${p.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.details || j.error);
        setRows(j.strategies);
        setPricesAt(j.pricesAt);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Desempenho das estratégias</h2>
        {pricesAt && <span className="text-xs text-gray-500 dark:text-gray-400">Abertas avaliadas ao preço Bybit de {fmtDate(pricesAt)} UTC</span>}
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Posições abertas no período escolhido (data de abertura). Resultados por trade na direção do sinal, <strong>sem custos</strong>.
        &quot;% do capital&quot; pesa cada trade pelo tamanho da posição (ex.: 10% por trade no pullback, pesos da carteira no momentum de resíduos).
      </p>

      {loading ? (
        <p className="text-gray-600 dark:text-gray-400">A calcular…</p>
      ) : error ? (
        <p className="text-red-600 dark:text-red-400">Erro: {error}</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">Sem sinais no período.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const v = verdict(r);
            const expanded = openRow === r.name;
            return (
              <div key={r.name} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                <button
                  type="button"
                  onClick={() => setOpenRow(expanded ? null : r.name)}
                  className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700/40 rounded-lg"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {r.name} <span className="text-sm font-normal text-gray-500">· {r.signals} sinais · {r.days} dia(s)</span>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded ${v.cls}`}>{v.text}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                    <Cell label="Média por trade (todos)" value={pct(r.all?.mean)} cls={tone(r.all?.mean)} />
                    <Cell label="Acerto (todos)" value={r.all ? `${r.all.winRate.toFixed(0)}%` : '—'} />
                    <Cell label="Fechados" value={r.closed ? `${r.closed.n} · ${pct(r.closed.mean)}` : '0'} cls={tone(r.closed?.mean)} />
                    <Cell label="Abertos (preço atual)" value={r.open ? `${r.open.n} · ${pct(r.open.mean)}` : '0'} cls={tone(r.open?.mean)} />
                    <Cell label="% do capital (total)" value={pct(r.capitalTotalPct)} cls={tone(r.capitalTotalPct)} />
                    <Cell label="Duração mediana (fechados)" value={fmtHours(r.medianHoursClosed)} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs mt-3 text-gray-600 dark:text-gray-400">
                    <span>Mediana: <span className={tone(r.all?.median)}>{pct(r.all?.median)}</span></span>
                    <span>Melhor: <span className={tone(r.all?.best)}>{pct(r.all?.best)}</span></span>
                    <span>Pior: <span className={tone(r.all?.worst)}>{pct(r.all?.worst)}</span></span>
                    <span>Capital fechados: <span className={tone(r.capitalClosedPct)}>{pct(r.capitalClosedPct)}</span></span>
                    <span>Capital abertos: <span className={tone(r.capitalOpenPct)}>{pct(r.capitalOpenPct)}</span></span>
                    <span>Executados na Bybit: {r.executed ? `${r.executed.n} · ${pct(r.executed.mean)}` : '0'}</span>
                  </div>
                  <div className="text-xs text-blue-600 dark:text-blue-400 mt-2">{expanded ? 'Esconder trades ▲' : 'Ver trades ▼'}</div>
                </button>
                {expanded && (
                  <div className="overflow-x-auto px-4 pb-4">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                          <th className="py-2 pr-3">Ativo</th>
                          <th className="py-2 pr-3">Lado</th>
                          <th className="py-2 pr-3">Abertura (UTC)</th>
                          <th className="py-2 pr-3">Entrada</th>
                          <th className="py-2 pr-3">Saída / atual</th>
                          <th className="py-2 pr-3">Resultado</th>
                          <th className="py-2 pr-3">Peso</th>
                          <th className="py-2 pr-3">Duração</th>
                          <th className="py-2 pr-3">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.trades.map((t) => (
                          <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700/60">
                            <td className="py-1.5 pr-3 font-medium text-gray-900 dark:text-white">{t.symbol.replace(/USDT$/, '')}</td>
                            <td className={`py-1.5 pr-3 ${t.direction === 'BUY' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {t.direction === 'BUY' ? 'Long' : 'Short'}
                            </td>
                            <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{fmtDate(t.openedAt)}</td>
                            <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{t.entryPrice.toPrecision(5)}</td>
                            <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{t.exitPrice != null ? t.exitPrice.toPrecision(5) : '—'}</td>
                            <td className={`py-1.5 pr-3 font-medium ${tone(t.resultPct)}`}>{pct(t.resultPct)}</td>
                            <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{t.weightPct.toFixed(1)}%</td>
                            <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{fmtHours(t.hours)}</td>
                            <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400" title={t.exitReason ?? ''}>
                              {t.status === 'OPEN' ? 'Aberta' : 'Fechada'}
                              {t.execStatus ? ` · ${t.execStatus}` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, cls = 'text-gray-900 dark:text-white' }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
