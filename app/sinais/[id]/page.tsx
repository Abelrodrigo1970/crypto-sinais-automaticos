'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import DirectionTag from '@/components/DirectionTag';
import StatusTag from '@/components/StatusTag';

interface Signal {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  strategyName: string;
  entryPrice: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  strength: number;
  status: string;
  generatedAt: string;
  extraInfo: string | null;
}

export default function SignalDetailPage() {
  const params = useParams();
  const [signal, setSignal] = useState<Signal | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      fetchSignal();
    }
  }, [params.id]);

  const fetchSignal = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/signals/${params.id}`);
      const data = await response.json();

      if (response.ok) {
        setSignal(data.signal);
        setCurrentPrice(data.currentPrice);
      }
    } catch (error) {
      console.error('Erro ao buscar sinal:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(price);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('pt-BR');
  };

  const calculateDistance = (target: number, entry: number, direction: string) => {
    if (direction === 'BUY') {
      return ((target - entry) / entry) * 100;
    } else {
      return ((entry - target) / entry) * 100;
    }
  };

  const calculateCurrentDistance = (current: number, entry: number, direction: string) => {
    if (direction === 'BUY') {
      return ((current - entry) / entry) * 100;
    } else {
      return ((entry - current) / entry) * 100;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando detalhes do sinal...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!signal) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Sinal não encontrado.</p>
            <Link
              href="/"
              className="mt-4 inline-block text-blue-600 dark:text-blue-400 hover:underline"
            >
              Voltar ao Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const extraInfo = signal.extraInfo ? JSON.parse(signal.extraInfo) : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/"
          className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
        >
          ← Voltar ao Dashboard
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 border border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                {signal.symbol}
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {signal.timeframe} • {signal.strategyName}
              </p>
            </div>
            <div className="flex flex-col items-end space-y-2">
              <DirectionTag direction={signal.direction} />
              <StatusTag status={signal.status} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Preço de Entrada</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                ${formatPrice(signal.entryPrice)}
              </p>
            </div>

            {currentPrice !== null && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Preço Atual</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  ${formatPrice(currentPrice)}
                </p>
                <p
                  className={`text-sm mt-1 ${
                    calculateCurrentDistance(currentPrice, signal.entryPrice, signal.direction) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {calculateCurrentDistance(currentPrice, signal.entryPrice, signal.direction) >= 0
                    ? '+'
                    : ''}
                  {calculateCurrentDistance(currentPrice, signal.entryPrice, signal.direction).toFixed(2)}%
                </p>
              </div>
            )}

            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Stop Loss</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                ${formatPrice(signal.stopLoss)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {calculateDistance(signal.stopLoss, signal.entryPrice, signal.direction).toFixed(2)}%
                {signal.direction === 'BUY' ? ' abaixo' : ' acima'} da entrada
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Força do Sinal</p>
              <div className="flex items-center space-x-2">
                <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full"
                    style={{ width: `${signal.strength}%` }}
                  />
                </div>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {signal.strength}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Targets</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {signal.target1 && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Target 1</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${formatPrice(signal.target1)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    +{calculateDistance(signal.target1, signal.entryPrice, signal.direction).toFixed(2)}%
                  </p>
                </div>
              )}
              {signal.target2 && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Target 2</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${formatPrice(signal.target2)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    +{calculateDistance(signal.target2, signal.entryPrice, signal.direction).toFixed(2)}%
                  </p>
                </div>
              )}
              {signal.target3 && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Target 3</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${formatPrice(signal.target3)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    +{calculateDistance(signal.target3, signal.entryPrice, signal.direction).toFixed(2)}%
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Informações Adicionais
            </h2>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Data de Geração</p>
              <p className="text-gray-900 dark:text-white">{formatDate(signal.generatedAt)}</p>
              {extraInfo && (
                <div className="mt-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Detalhes do Cálculo</p>
                  <pre className="text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-600 overflow-x-auto">
                    {JSON.stringify(extraInfo, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          <Disclaimer />
        </div>
      </main>
    </div>
  );
}




