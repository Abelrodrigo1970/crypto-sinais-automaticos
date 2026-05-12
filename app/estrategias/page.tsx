'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface SymbolUniverseOption {
  id: string | null;
  code: string;
  displayName: string;
}

interface Strategy {
  id: string;
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  params: string;
  symbolUniverseId?: string | null;
  symbolUniverse?: SymbolUniverseOption | null;
}

export default function EstrategiasPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [universes, setUniverses] = useState<SymbolUniverseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [binanceExecutionOn, setBinanceExecutionOn] = useState<boolean | null>(null);
  const [binanceToggleSaving, setBinanceToggleSaving] = useState(false);

  useEffect(() => {
    fetchStrategies();
    fetchUniverses();
    fetchTradingControl();
  }, []);

  const fetchUniverses = async () => {
    try {
      const response = await fetch('/api/symbol-universes');
      const data = await response.json();
      if (response.ok && Array.isArray(data.universes)) {
        setUniverses(data.universes);
      }
    } catch (error) {
      console.error('Erro ao buscar universos:', error);
    }
  };

  const fetchTradingControl = async () => {
    try {
      const res = await fetch('/api/trading-control');
      const data = await res.json();
      if (res.ok && typeof data.binanceExecutionOn === 'boolean') {
        setBinanceExecutionOn(data.binanceExecutionOn);
      } else {
        setBinanceExecutionOn(true);
      }
    } catch {
      setBinanceExecutionOn(true);
    }
  };

  const handleBinanceToggle = async (next: boolean) => {
    try {
      setBinanceToggleSaving(true);
      const res = await fetch('/api/trading-control', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ binanceExecutionOn: next }),
      });
      const data = await res.json();
      if (res.ok && typeof data.binanceExecutionOn === 'boolean') {
        setBinanceExecutionOn(data.binanceExecutionOn);
        setMessage(
          data.binanceExecutionOn
            ? 'Binance: execução de trades ativada (ON).'
            : 'Binance: execução de trades em pausa (OFF).'
        );
        setTimeout(() => setMessage(''), 4000);
      } else {
        setMessage('Erro ao atualizar interruptor Binance');
      }
    } catch {
      setMessage('Erro ao atualizar interruptor Binance');
    } finally {
      setBinanceToggleSaving(false);
    }
  };

  const fetchStrategies = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/strategies');
      const data = await response.json();

      if (response.ok) {
        setStrategies(data.strategies);
      }
    } catch (error) {
      console.error('Erro ao buscar estratégias:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (strategy: Strategy) => {
    try {
      setSaving(strategy.id);
      const response = await fetch('/api/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: strategy.id,
          isActive: !strategy.isActive,
        }),
      });

      if (response.ok) {
        await fetchStrategies();
        setMessage('Estratégia atualizada com sucesso');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Erro ao atualizar estratégia');
      }
    } catch (error) {
      setMessage('Erro ao atualizar estratégia');
    } finally {
      setSaving(null);
    }
  };

  const handleUniverseChange = async (strategy: Strategy, symbolUniverseId: string | null) => {
    try {
      setSaving(strategy.id);
      const response = await fetch('/api/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: strategy.id,
          symbolUniverseId,
        }),
      });

      if (response.ok) {
        await fetchStrategies();
        setMessage('Universo de símbolos atualizado');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Erro ao atualizar universo');
      }
    } catch (error) {
      setMessage('Erro ao atualizar universo');
    } finally {
      setSaving(null);
    }
  };

  const handleUpdateParams = async (strategy: Strategy, newParams: any) => {
    try {
      setSaving(strategy.id);
      const response = await fetch('/api/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: strategy.id,
          params: newParams,
        }),
      });

      if (response.ok) {
        await fetchStrategies();
        setMessage('Parâmetros atualizados com sucesso');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Erro ao atualizar parâmetros');
      }
    } catch (error) {
      setMessage('Erro ao atualizar parâmetros');
    } finally {
      setSaving(null);
    }
  };

  const getDefaultParams = (strategyName: string) => {
    switch (strategyName) {
      case 'MA_CROSSOVER':
        return { fastPeriod: 9, slowPeriod: 21 };
      case 'MACD':
        return { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };
      default:
        return {};
    }
  };

  const renderStrategyParams = (strategy: Strategy) => {
    const params = JSON.parse(strategy.params || '{}');
    const defaults = getDefaultParams(strategy.name);

    switch (strategy.name) {
      case 'MA_CROSSOVER':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                MA Curta
              </label>
              <input
                type="number"
                defaultValue={params.fastPeriod || defaults.fastPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    fastPeriod: parseInt(e.target.value) || defaults.fastPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                MA Longa
              </label>
              <input
                type="number"
                defaultValue={params.slowPeriod || defaults.slowPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    slowPeriod: parseInt(e.target.value) || defaults.slowPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
        );

      case 'MACD':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Fast Period
              </label>
              <input
                type="number"
                defaultValue={params.fastPeriod || defaults.fastPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    fastPeriod: parseInt(e.target.value) || defaults.fastPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Slow Period
              </label>
              <input
                type="number"
                defaultValue={params.slowPeriod || defaults.slowPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    slowPeriod: parseInt(e.target.value) || defaults.slowPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Signal Period
              </label>
              <input
                type="number"
                defaultValue={params.signalPeriod || defaults.signalPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    signalPeriod: parseInt(e.target.value) || defaults.signalPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
        );

      default:
        return <p className="text-sm text-gray-500 dark:text-gray-400">Sem parâmetros configuráveis</p>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">Estratégias</h1>

        <div className="mb-8 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Binance Futures</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-xl">
                Interruptor global: em OFF, o botão «Executar trade» nos sinais fica bloqueado e nenhuma ordem
                real é enviada até voltares a ligar.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span
                className={`text-sm font-medium ${
                  binanceExecutionOn === false
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-green-700 dark:text-green-400'
                }`}
              >
                {binanceExecutionOn === null
                  ? 'A carregar…'
                  : binanceExecutionOn
                    ? 'ON'
                    : 'OFF'}
              </span>
              <button
                type="button"
                disabled={binanceExecutionOn === null || binanceToggleSaving}
                onClick={() => handleBinanceToggle(!(binanceExecutionOn ?? true))}
                className={`min-w-[8.5rem] px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  binanceExecutionOn
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {binanceToggleSaving
                  ? 'A guardar…'
                  : binanceExecutionOn
                    ? 'Pausar (OFF)'
                    : 'Ativar (ON)'}
              </button>
            </div>
          </div>
        </div>

        {message && (
          <div
            className={`mb-4 p-4 rounded-lg ${
              message.includes('Erro')
                ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
            }`}
          >
            {message}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando estratégias...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {strategies.map((strategy) => (
              <div
                key={strategy.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        {strategy.displayName}
                      </h2>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          strategy.isActive
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {strategy.isActive ? 'Ativa' : 'Inativa'}
                      </span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400">{strategy.description}</p>
                  </div>
                  <button
                    onClick={() => handleToggleActive(strategy)}
                    disabled={saving === strategy.id}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      strategy.isActive
                        ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800'
                        : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800'
                    }`}
                  >
                    {saving === strategy.id
                      ? 'Salvando...'
                      : strategy.isActive
                      ? 'Desativar'
                      : 'Ativar'}
                  </button>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Universo de símbolos (Scanner BD)
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Se escolheres Scanner 1 ou 2, o motor só analisa esses pares em vez da lista por defeito
                    (ex.: MA60 mantinha market cap; com universo, vale o universo).
                  </p>
                  <select
                    value={strategy.symbolUniverseId ?? ''}
                    disabled={saving === strategy.id}
                    onChange={(e) =>
                      handleUniverseChange(
                        strategy,
                        e.target.value === '' ? null : e.target.value
                      )
                    }
                    className="w-full max-w-lg px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  >
                    <option value="">Predefinição (sem universo Scanner 1/2)</option>
                    {universes
                      .filter((u) => u.id)
                      .map((u) => (
                        <option key={u.id!} value={u.id!}>
                          {u.displayName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                    Parâmetros
                  </h3>
                  {renderStrategyParams(strategy)}
                </div>
              </div>
            ))}
          </div>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}






