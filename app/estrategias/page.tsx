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
  params: string;
  timeframe: string;
  universe: { types?: string[]; minTurnover24h?: number } | null;
}

export default function EstrategiasPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');

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
  }, []);

  const save = async (strategy: Strategy, body: { isActive?: boolean; params?: unknown }) => {
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
                  <button
                    onClick={() => save(strategy, { isActive: !strategy.isActive })}
                    disabled={saving === strategy.id}
                    className={`px-4 py-2 rounded-lg font-medium text-white shrink-0 ${
                      strategy.isActive ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-500 hover:bg-gray-600'
                    }`}
                  >
                    {strategy.isActive ? 'Ativa' : 'Inativa'}
                  </button>
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
