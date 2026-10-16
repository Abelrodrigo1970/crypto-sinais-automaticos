'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface Strategy {
  id: string;
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  tradingOn: boolean;
  params: string;
  timeframe: string;
  universe: { types?: string[]; minTurnover24h?: number } | null;
}

interface TradingStatus {
  envEnabled: boolean;
  hasCredentials: boolean;
  testnet: boolean;
  positionPct: number;
  maxPositions: number;
  leverage: number;
  maxSlippagePct: number;
  switchOn: boolean;
  wallet: { totalEquity: number; totalAvailableBalance: number } | null;
  walletError: string | null;
  openPositions: number;
  pendingExits: number;
}

export default function EstrategiasPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [trading, setTrading] = useState<TradingStatus | null>(null);

  const fetchTrading = async () => {
    try {
      const res = await fetch('/api/trading-control');
      if (res.ok) setTrading(await res.json());
    } catch {
      setTrading(null);
    }
  };

  const toggleTrading = async (on: boolean) => {
    const res = await fetch('/api/trading-control', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bybitTradingOn: on }),
    });
    setMessage(res.ok ? (on ? 'Ordens Bybit ligadas.' : 'Ordens Bybit desligadas: sem entradas novas.') : 'Erro ao mudar o interruptor Bybit.');
    setTimeout(() => setMessage(''), 4000);
    fetchTrading();
  };

  const fetchStrategies = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/strategies');
      const data = await response.json();
      if (response.ok) {
        setStrategies(data.strategies);
        setDrafts(
          Object.fromEntries(
            data.strategies.map((s: Strategy) => [s.id, JSON.stringify(JSON.parse(s.params || '{}'), null, 2)])
          )
        );
      }
    } catch (error) {
      console.error('Erro ao buscar estratégias:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStrategies();
    fetchTrading();
  }, []);

  const save = async (strategy: Strategy, body: { isActive?: boolean; tradingOn?: boolean; params?: unknown }) => {
    try {
      setSaving(strategy.id);
      const response = await fetch('/api/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: strategy.id, ...body }),
      });
      if (response.ok) {
        setMessage(`${strategy.displayName}: guardado.`);
        await fetchStrategies();
      } else {
        setMessage(`Erro ao guardar ${strategy.displayName}`);
      }
    } catch {
      setMessage(`Erro ao guardar ${strategy.displayName}`);
    } finally {
      setSaving(null);
      setTimeout(() => setMessage(''), 4000);
    }
  };

  const saveParams = (strategy: Strategy) => {
    try {
      const params = JSON.parse(drafts[strategy.id] || '{}');
      save(strategy, { params });
    } catch {
      setMessage('Parâmetros inválidos: tem de ser JSON.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Estratégias</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Ações e ETFs cotados como perpétuos USDT na Bybit.
        </p>

        {message && (
          <div className="mb-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
            {message}
          </div>
        )}

        {trading && (
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex flex-wrap justify-between items-start gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Ordens Bybit{' '}
                  <span
                    className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded ${
                      trading.testnet
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    }`}
                  >
                    {trading.testnet ? 'TESTNET' : 'CONTA REAL'}
                  </span>
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {trading.positionPct}% do saldo por posição · alavancagem {trading.leverage}x · máx. {trading.maxPositions} posições ·
                  slippage máx. {trading.maxSlippagePct}% (ordens limite IOC)
                </p>
                <ul className="text-sm mt-3 space-y-1">
                  <li className={trading.envEnabled ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                    {trading.envEnabled ? '✓' : '✗'} BYBIT_TRADING_ENABLED{trading.envEnabled ? '' : ' (tem de ser true no Railway)'}
                  </li>
                  <li className={trading.hasCredentials ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                    {trading.hasCredentials ? '✓' : '✗'} Chaves API (BYBIT_API_KEY / BYBIT_API_SECRET)
                  </li>
                  {trading.wallet && (
                    <li className="text-gray-700 dark:text-gray-300">
                      Saldo: {trading.wallet.totalEquity.toFixed(2)} USDT · disponível {trading.wallet.totalAvailableBalance.toFixed(2)} · posição ≈{' '}
                      {((trading.wallet.totalEquity * trading.positionPct) / 100).toFixed(2)} USDT
                    </li>
                  )}
                  {trading.walletError && <li className="text-red-700 dark:text-red-400">Erro na conta: {trading.walletError}</li>}
                  <li className="text-gray-700 dark:text-gray-300">
                    {trading.openPositions} posições executadas abertas
                    {trading.pendingExits > 0 && (
                      <span className="text-red-700 dark:text-red-400"> · {trading.pendingExits} saídas por executar</span>
                    )}
                  </li>
                </ul>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 max-w-2xl">
                  Uma entrada só é enviada com o interruptor global e o da estratégia ligados. Desligar bloqueia entradas novas;
                  as posições já abertas continuam a ser fechadas pela regra da estratégia.
                </p>
              </div>
              <button
                onClick={() => toggleTrading(!trading.switchOn)}
                disabled={!trading.envEnabled || !trading.hasCredentials}
                className={`px-5 py-2 rounded-lg font-semibold text-white shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                  trading.switchOn ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-500 hover:bg-gray-600'
                }`}
              >
                {trading.switchOn ? 'Ordens ON' : 'Ordens OFF'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-600 dark:text-gray-400">A carregar estratégias...</p>
        ) : strategies.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
            <p className="text-gray-700 dark:text-gray-300">
              Ainda não há estratégias. Cada estratégia nova é adicionada em{' '}
              <code className="text-sm">lib/strategies/</code> e aparece aqui automaticamente.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {strategies.map((strategy) => (
              <div
                key={strategy.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex justify-between items-start gap-4 mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{strategy.displayName}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {strategy.name} • {strategy.timeframe}
                      {strategy.universe?.types ? ` • ${strategy.universe.types.join(' + ')}` : ' • stock + ETF'}
                    </p>
                    <p className="text-gray-700 dark:text-gray-300 mt-2">{strategy.description}</p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => save(strategy, { isActive: !strategy.isActive })}
                    disabled={saving === strategy.id}
                    className={`px-4 py-2 rounded-lg font-medium text-white shrink-0 ${
                      strategy.isActive ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-500 hover:bg-gray-600'
                    }`}
                  >
                    {strategy.isActive ? 'Ativa' : 'Inativa'}
                  </button>
                  <button
                    onClick={() => save(strategy, { tradingOn: !strategy.tradingOn })}
                    disabled={saving === strategy.id}
                    title="Enviar ordens Bybit para os sinais desta estratégia"
                    className={`px-4 py-2 rounded-lg font-medium text-white text-sm ${
                      strategy.tradingOn ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-500 hover:bg-gray-600'
                    }`}
                  >
                    {strategy.tradingOn ? 'Bybit: ordens ON' : 'Bybit: ordens OFF'}
                  </button>
                  </div>
                </div>

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Parâmetros (JSON)
                </label>
                <textarea
                  value={drafts[strategy.id] ?? ''}
                  onChange={(e) => setDrafts({ ...drafts, [strategy.id]: e.target.value })}
                  rows={6}
                  className="w-full font-mono text-sm p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
                <button
                  onClick={() => saveParams(strategy)}
                  disabled={saving === strategy.id}
                  className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg"
                >
                  Guardar parâmetros
                </button>
              </div>
            ))}
          </div>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}
