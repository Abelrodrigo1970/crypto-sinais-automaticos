/**
 * Testes simples para o scanner A+
 * 
 * Para executar: tsx lib/scannerAplus.test.ts
 */

import {
  detectRegime,
  checkInZone,
  checkAntiTradeFilters,
  type MarketData,
  type ScannerConfig,
} from './scannerAplus';
import type { Candle } from './marketData';

// Mock de dados de mercado para testes
function createMockMarketData(overrides: Partial<MarketData> = {}): MarketData {
  const baseCandles: Candle[] = Array.from({ length: 300 }, (_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100 + (i % 10) * 0.1,
    volume: 1000,
    timestamp: Date.now() - (300 - i) * 3600000,
  }));

  return {
    candles1h: baseCandles,
    candles15m: baseCandles,
    ema200_1h: 100,
    ema200_1h_10barsAgo: 99,
    ema21_1h: 100.5,
    ema21_15m: 100.3,
    atr14_1h: 2,
    atr14_15m: 1,
    rsi14_15m: 50,
    volumeMA20_15m: 1000,
    currentPrice: 100.5,
    ...overrides,
  };
}

// Teste 1: Detecção de regime BULLISH
function testDetectRegimeBullish() {
  console.log('Teste 1: Detecção de regime BULLISH');
  const data = createMockMarketData({
    candles1h: Array.from({ length: 300 }, (_, i) => ({
      open: 100,
      high: 101,
      low: 99,
      close: 101, // Acima da EMA200
      volume: 1000,
      timestamp: Date.now() - (300 - i) * 3600000,
    })),
    ema200_1h: 100,
    ema200_1h_10barsAgo: 99, // EMA200 subindo
  });

  const result = detectRegime(data);
  console.log('  Resultado:', result);
  console.log('  ✓ Passou:', result.trend === 'BULLISH');
  console.log('');
}

// Teste 2: Detecção de regime BEARISH
function testDetectRegimeBearish() {
  console.log('Teste 2: Detecção de regime BEARISH');
  const data = createMockMarketData({
    candles1h: Array.from({ length: 300 }, (_, i) => ({
      open: 100,
      high: 101,
      low: 99,
      close: 99, // Abaixo da EMA200
      volume: 1000,
      timestamp: Date.now() - (300 - i) * 3600000,
    })),
    ema200_1h: 100,
    ema200_1h_10barsAgo: 101, // EMA200 descendo
  });

  const result = detectRegime(data);
  console.log('  Resultado:', result);
  console.log('  ✓ Passou:', result.trend === 'BEARISH');
  console.log('');
}

// Teste 3: Verificação de zona (próximo da EMA21)
function testCheckInZone() {
  console.log('Teste 3: Verificação de zona');
  const data = createMockMarketData({
    candles1h: Array.from({ length: 300 }, (_, i) => ({
      open: 100,
      high: 101,
      low: 99,
      close: 100.5, // Próximo da EMA21 (100.5)
      volume: 1000,
      timestamp: Date.now() - (300 - i) * 3600000,
    })),
    ema21_1h: 100.5,
    atr14_1h: 2, // 0.5 * ATR = 1, então distância de 0.5 está OK
  });

  const result = checkInZone(data);
  console.log('  Resultado:', result);
  console.log('  ✓ Passou:', result.inZone === true);
  console.log('');
}

// Teste 4: Filtro de volatilidade (ATR muito baixo)
function testAntiTradeFilterLowATR() {
  console.log('Teste 4: Filtro anti-trade - ATR muito baixo');
  const data = createMockMarketData({
    currentPrice: 100,
    atr14_15m: 0.2, // ATR% = 0.2%, abaixo do mínimo (0.3%)
  });

  const config: ScannerConfig = {
    topSymbolsLimit: 50,
    minQuoteVolume: 0,
    minATRPercent: 0.3,
    maxATRPercent: 2.5,
    minEntryScore: 7,
    topNAlerts: 3,
    enableBreakoutRetest: false,
    breakoutPeriod: 48,
    cooldownMinutes: 60,
  };

  const result = checkAntiTradeFilters(data, config);
  console.log('  Resultado:', result);
  console.log('  ✓ Passou:', result.passed === false);
  console.log('');
}

// Teste 5: Filtro de volatilidade (ATR muito alto)
function testAntiTradeFilterHighATR() {
  console.log('Teste 5: Filtro anti-trade - ATR muito alto');
  const data = createMockMarketData({
    currentPrice: 100,
    atr14_15m: 3, // ATR% = 3%, acima do máximo (2.5%)
  });

  const config: ScannerConfig = {
    topSymbolsLimit: 50,
    minQuoteVolume: 0,
    minATRPercent: 0.3,
    maxATRPercent: 2.5,
    minEntryScore: 7,
    topNAlerts: 3,
    enableBreakoutRetest: false,
    breakoutPeriod: 48,
    cooldownMinutes: 60,
  };

  const result = checkAntiTradeFilters(data, config);
  console.log('  Resultado:', result);
  console.log('  ✓ Passou:', result.passed === false);
  console.log('');
}

// Executar todos os testes
if (require.main === module) {
  console.log('🧪 Executando testes do Scanner A+\n');
  testDetectRegimeBullish();
  testDetectRegimeBearish();
  testCheckInZone();
  testAntiTradeFilterLowATR();
  testAntiTradeFilterHighATR();
  console.log('✅ Testes concluídos!');
}



