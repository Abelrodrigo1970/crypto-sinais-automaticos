'use client';

import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

export default function ScannersHubPage() {
  const cards = [
    {
      href: '/scanner',
      title: 'Scanner Trades A+',
      desc: 'Setups TREND_PULLBACK e BREAKOUT_RETEST (15m / score).',
    },
    {
      href: '/scanners/universos',
      title: 'Universos MA200',
      desc: 'Lista perpétuos USDT acima da MA200 ou dentro de ±10% da MA200 (1h).',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Scanners</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Escolhe o tipo de varredura. Os universos MA200 também podem ser ligados a estratégias em{' '}
          <Link href="/estrategias" className="text-blue-600 dark:text-blue-400 underline">
            Estratégias
          </Link>
          .
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="block bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
            >
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{c.title}</h2>
              <p className="text-gray-600 dark:text-gray-400">{c.desc}</p>
            </Link>
          ))}
        </div>
        <Disclaimer />
      </main>
    </div>
  );
}
