'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import StrategyPerformance from '@/components/StrategyPerformance';

const formatDateLabel = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};

export default function EstatisticasPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">Estatísticas dos Resultados</h1>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Período</h2>
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white self-start sm:self-auto"
              >
                Limpar datas
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end">
            <div>
              <label htmlFor="dateFrom" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Data inicial</label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="dateTo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Data final</label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 pb-2">
              {dateFrom && dateTo
                ? `Posições abertas entre ${formatDateLabel(dateFrom)} e ${formatDateLabel(dateTo)}`
                : dateFrom
                  ? `Posições abertas desde ${formatDateLabel(dateFrom)}`
                  : dateTo
                    ? `Posições abertas até ${formatDateLabel(dateTo)}`
                    : 'Todas as posições'}
            </div>
          </div>
        </div>

        <StrategyPerformance dateFrom={dateFrom} dateTo={dateTo} />

        <Disclaimer />
      </main>
    </div>
  );
}
