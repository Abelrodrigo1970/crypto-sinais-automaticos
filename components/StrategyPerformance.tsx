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
  grossPct: number | null;
  feesPct: number;
  slipPct: number;
  fundingPct: number;
  resultPct: number | null;
  weightPct: number;
  hours: number;
  exitReason: string | null;
  execStatus: string | null;
  executed: boolean;
  left: number;
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
  capitalGrossPct: number;
  grossMean: number | null;
  costs: { fees: number; slip: number; funding: number };
  investedPct: number;
  medianHoursClosed: number | null;
  executedCount: number;
  trades: Trade[];
};

const usd = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('pt-PT', { maximumFractionDigits: 0 })} USDT`;
const readNum = (k: string, d: number) => {
  try {
    const v = parseFloat(localStorage.getItem(k) ?? '');
    return Number.isFinite(v) ? v : d;
  } catch {
    return d;
  }
};
const saveNum = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* sem armazenamento */
  }
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
  const [capitalUsd, setCapitalUsd] = useState(10000);
  const [feePct, setFeePct] = useState(0.055);
  const [slipPct, setSlipPct] = useState(0.05);
  const [fundingErrors, setFundingErrors] = useState(0);

  useEffect(() => {
    setCapitalUsd(readNum('perf.capital', 10000));
    setFeePct(readNum('perf.fee', 0.055));
    setSlipPct(readNum('perf.slip', 0.05));
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    p.set('feePct', String(feePct));
    p.set('slipPct', String(slipPct));
    setLoading(true);
    fetch(`/api/strategy-performance?${p.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.details || j.error);
        setRows(j.strategies);
        setPricesAt(j.pricesAt);
        setFundingErrors(j.costs?.fundingErrors ?? 0);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, feePct, slipPct]);

  const total = rows.reduce((a, r) => a + r.capitalTotalPct, 0);
  const totalGross = rows.reduce((a, r) => a + r.capitalGrossPct, 0);
  const invested = rows.reduce((a, r) => a + r.investedPct, 0);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Desempenho das estratégias</h2>
        {pricesAt && <span className="text-xs text-gray-500 dark:text-gray-400">Abertas avaliadas ao bid/ask da Bybit de {fmtDate(pricesAt)} UTC</span>}
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Resultados <strong>líquidos</strong>, como se cada sinal tivesse sido executado: comissões de entrada e saída, slippage
        (zero quando houve execução real na Bybit, que usa os preços efetivos) e o <strong>funding real</strong> pago ou recebido
        durante a posição. As abertas contam como se fechassem agora ao bid (long) ou ao ask (short); as vendas parciais já feitas contam ao preço de venda.
        &quot;% do capital&quot; pesa cada trade pelo tamanho da posição.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Capital (USDT)
          <input id="perfCapital" type="number" min={0} step={500} value={capitalUsd}
            onChange={(e) => { const v = Math.max(0, parseFloat(e.target.value) || 0); setCapitalUsd(v); saveNum('perf.capital', v); }}
            className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Comissão por lado (%)
          <input id="perfFee" type="number" min={0} max={1} step={0.005} value={feePct}
            onChange={(e) => { const v = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)); setFeePct(v); saveNum('perf.fee', v); }}
            className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          <span className="text-xs text-gray-500">Bybit taker, nível base: 0,055%</span>
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Slippage por lado (%)
          <input id="perfSlip" type="number" min={0} max={2} step={0.01} value={slipPct}
            onChange={(e) => { const v = Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)); setSlipPct(v); saveNum('perf.slip', v); }}
            className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          <span className="text-xs text-gray-500">Diferença entre o preço do sinal e o preço obtido</span>
        </label>
      </div>

      {!loading && !error && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
          <Cell label="Todas as estratégias (líquido)" value={`${pct(total)} · ${usd((total / 100) * capitalUsd)}`} cls={tone(total)} />
          <Cell label="Antes de custos" value={pct(totalGross)} cls={tone(totalGross)} />
          <Cell label="Custos no período" value={usd(((total - totalGross) / 100) * capitalUsd)} cls={tone(total - totalGross)} />
          <Cell label="Capital investido agora" value={`${invested.toFixed(0)}% · ${Math.round((invested / 100) * capitalUsd).toLocaleString('pt-PT')} USDT`} />
        </div>
      )}
      {fundingErrors > 0 && <p className="text-xs text-amber-600 mb-3">Sem histórico de funding para {fundingErrors} ativo(s); nesses o funding conta como zero.</p>}

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
                    <Cell label="% do capital (total)" value={`${pct(r.capitalTotalPct)} · ${usd((r.capitalTotalPct / 100) * capitalUsd)}`} cls={tone(r.capitalTotalPct)} />
                    <Cell label="Duração mediana (fechados)" value={fmtHours(r.medianHoursClosed)} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs mt-3 text-gray-600 dark:text-gray-400">
                    <span>Mediana: <span className={tone(r.all?.median)}>{pct(r.all?.median)}</span></span>
                    <span>Melhor: <span className={tone(r.all?.best)}>{pct(r.all?.best)}</span></span>
                    <span>Pior: <span className={tone(r.all?.worst)}>{pct(r.all?.worst)}</span></span>
                    <span>Capital fechados: <span className={tone(r.capitalClosedPct)}>{pct(r.capitalClosedPct)}</span></span>
                    <span>Capital abertos: <span className={tone(r.capitalOpenPct)}>{pct(r.capitalOpenPct)}</span></span>
                    <span>Antes de custos: <span className={tone(r.grossMean)}>{pct(r.grossMean)}</span> por trade</span>
                    <span>Custos por trade: comissões {pct(r.costs.fees)} · slippage {pct(r.costs.slip)} · funding <span className={tone(r.costs.funding)}>{pct(r.costs.funding, 3)}</span></span>
                    <span>Executados na Bybit: {r.executedCount}</span>
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
                          <th className="py-2 pr-3">Bruto</th>
                          <th className="py-2 pr-3">Funding</th>
                          <th className="py-2 pr-3">Líquido</th>
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
                            <td className={`py-1.5 pr-3 ${tone(t.grossPct)}`}>{pct(t.grossPct)}</td>
                            <td className={`py-1.5 pr-3 ${tone(t.fundingPct)}`}>{pct(t.fundingPct, 3)}</td>
                            <td className={`py-1.5 pr-3 font-medium ${tone(t.resultPct)}`}>{pct(t.resultPct)}</td>
                            <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{t.weightPct.toFixed(1)}%</td>
                            <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{fmtHours(t.hours)}</td>
                            <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400" title={t.exitReason ?? ''}>
                              {t.status === 'OPEN' ? (t.left < 1 ? `Aberta (${Math.round(t.left * 100)}% por vender)` : 'Aberta') : 'Fechada'}
                              {t.executed ? ' · execução real' : t.execStatus ? ` · ${t.execStatus}` : ''}
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
