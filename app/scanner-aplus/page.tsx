'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface Alert {
  symbol: string;
  side: 'LONG' | 'SHORT';
  setup: 'TREND_PULLBACK' | 'BREAKOUT_RETEST';
  alert_type: 'PRE-SETUP' | 'ENTRY';
  timeframe: string;
  score: number;
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  atr_pct_15m: number;
  reasons: string[];
  timestamp: number;
}

interface ScannerConfig {
  topSymbolsLimit: number;
  minQuoteVolume: number;
  minATRPercent: number;
  maxATRPercent: number;
  minEntryScore: number;
  topNAlerts: number;
  enableBreakoutRetest: boolean;
  breakoutPeriod: number;
  cooldownMinutes: number;
}

export default function ScannerAPlusPage() {
  const [entries, setEntries] = useState<Alert[]>([]);
  const [preSetups, setPreSetups] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [config, setConfig] = useState<ScannerConfig>({
    topSymbolsLimit: 50,
    minQuoteVolume: 0,
    minATRPercent: 0.3,
    maxATRPercent: 2.5,
    minEntryScore: 7,
    topNAlerts: 3,
    enableBreakoutRetest: false,
    breakoutPeriod: 48,
    cooldownMinutes: 60,
  });
  const [showConfig, setShowConfig] = useState(false);

  const runScanner = async () => {
    try {
      setScanning(true);
      setMessage('');
      const response = await fetch('/api/scanner-aplus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });

      const data = await response.json();

      if (response.ok) {
        setEntries(data.entries || []);
        setPreSetups(data.preSetups || []);
        setMessage(
          `Scanner executado: ${data.count.entries} entrada(s) e ${data.count.preSetups} pré-setup(s) encontrado(s)`
        );
      } else {
        setMessage(data.error || 'Erro ao executar scanner');
      }
    } catch (error) {
      setMessage('Erro ao executar scanner. Tente novamente.');
      console.error(error);
    } finally {
      setScanning(false);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(price);
  };

  const calculateRR = (entry: number, stop: number, target: number) => {
    const risk = Math.abs(entry - stop);
    if (risk === 0) return 0;
    return Math.abs(target - entry) / risk;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Scanner A+ Trades
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Análise de alta qualidade para Binance USDT-M Futures
            </p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
            >
              {showConfig ? 'Ocultar' : 'Configurações'}
            </button>
            <button
              onClick={runScanner}
              disabled={scanning}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors"
            >
              {scanning ? 'Escaneando...' : 'Executar Scanner'}
            </button>
          </div>
        </div>

        {showConfig && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Configurações do Scanner
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Top Símbolos
                </label>
                <input
                  type="number"
                  value={config.topSymbolsLimit}
                  onChange={(e) =>
                    setConfig({ ...config, topSymbolsLimit: parseInt(e.target.value) || 50 })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Volume Mínimo (USDT)
                </label>
                <input
                  type="number"
                  value={config.minQuoteVolume}
                  onChange={(e) =>
                    setConfig({ ...config, minQuoteVolume: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  ATR% Mínimo
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={config.minATRPercent}
                  onChange={(e) =>
                    setConfig({ ...config, minATRPercent: parseFloat(e.target.value) || 0.3 })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  ATR% Máximo
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={config.maxATRPercent}
                  onChange={(e) =>
                    setConfig({ ...config, maxATRPercent: parseFloat(e.target.value) || 2.5 })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Score Mínimo (ENTRY)
                </label>
                <input
                  type="number"
                  value={config.minEntryScore}
                  onChange={(e) =>
                    setConfig({ ...config, minEntryScore: parseInt(e.target.value) || 7 })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Top N Alertas
                </label>
                <input
                  type="number"
                  value={config.topNAlerts}
                  onChange={(e) =>
                    setConfig({ ...config, topNAlerts: parseInt(e.target.value) || 3 })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={config.enableBreakoutRetest}
                    onChange={(e) =>
                      setConfig({ ...config, enableBreakoutRetest: e.target.checked })
                    }
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Habilitar BREAKOUT_RETEST
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

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

        {scanning ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">
              Escaneando mercado... Isso pode levar alguns minutos.
            </p>
          </div>
        ) : (
          <>
            {/* ENTRY Alerts */}
            {entries.length > 0 && (
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  🎯 Entradas A+ (Score ≥ {config.minEntryScore})
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {entries.map((alert, index) => (
                    <div
                      key={`${alert.symbol}-${alert.timestamp}`}
                      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border-2 border-blue-500 dark:border-blue-400"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                            {alert.symbol}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {alert.setup} • {alert.timeframe}
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`px-3 py-1 rounded-full text-sm font-bold ${
                              alert.side === 'LONG'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                            }`}
                          >
                            {alert.side}
                          </span>
                          <div className="mt-2">
                            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                              {alert.score}/10
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 mb-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Entry</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                              ${formatPrice(alert.entry)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Stop</p>
                            <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                              ${formatPrice(alert.stop)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Target 1</p>
                            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                              ${formatPrice(alert.t1)} (1R)
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Target 2</p>
                            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                              ${formatPrice(alert.t2)} (2R)
                            </p>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">ATR% 15m</p>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {alert.atr_pct_15m.toFixed(2)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">R:R</p>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {calculateRR(alert.entry, alert.stop, alert.t2).toFixed(2)}:1
                          </p>
                        </div>
                      </div>

                      <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Razões:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {alert.reasons.map((reason, i) => (
                            <span
                              key={i}
                              className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs rounded text-gray-700 dark:text-gray-300"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PRE-SETUP Alerts */}
            {preSetups.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  👁️ Pré-Setups (Ficar de Olho)
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {preSetups.map((alert, index) => (
                    <div
                      key={`${alert.symbol}-${alert.timestamp}`}
                      className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {alert.symbol}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {alert.setup} • {alert.timeframe}
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            alert.side === 'LONG'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          }`}
                        >
                          {alert.side}
                        </span>
                      </div>

                      <div className="space-y-2 mb-4">
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Preço Atual</p>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">
                            ${formatPrice(alert.entry)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">ATR% 15m</p>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {alert.atr_pct_15m.toFixed(2)}%
                          </p>
                        </div>
                      </div>

                      <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Condições:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {alert.reasons.map((reason, i) => (
                            <span
                              key={i}
                              className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs rounded text-gray-700 dark:text-gray-300"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {entries.length === 0 && preSetups.length === 0 && !scanning && (
              <div className="text-center py-12">
                <p className="text-gray-600 dark:text-gray-400">
                  Nenhum alerta encontrado. Execute o scanner para buscar oportunidades.
                </p>
              </div>
            )}
          </>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}



