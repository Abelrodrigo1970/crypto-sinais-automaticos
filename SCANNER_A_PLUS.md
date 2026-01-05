# Scanner A+ Trades - Documentação

## Visão Geral

O Scanner A+ é um sistema avançado de análise técnica para Binance USDT-M Futures Perpetual que identifica setups de alta qualidade, evitando spam de sinais de baixa qualidade.

## Características Principais

- ✅ Análise de **50 criptomoedas** top por volume
- ✅ Timeframes: **1H** (regime/setup) e **15m** (gatilho)
- ✅ Indicadores técnicos: EMA200, EMA21, ATR14, RSI14, VolumeMA20
- ✅ Dois tipos de alerta: **PRE-SETUP** e **ENTRY**
- ✅ Sistema de score 0-10 para filtrar apenas trades A+
- ✅ Filtros anti-trade ruim (liquidez, volatilidade)
- ✅ Gestão de risco integrada (2% por trade)

## Estratégias Implementadas

### 1. TREND_PULLBACK (Principal)

**Regime (1H):**
- LONG: Close(1H) > EMA200(1H) e EMA200 inclinada para cima
- SHORT: Close(1H) < EMA200(1H) e EMA200 inclinada para baixo

**Zona / PRE-SETUP:**
- Preço próximo da EMA21(1H): `abs(preço - EMA21_1H) <= 0.5 * ATR14_1H`
- Gera alerta PRE-SETUP quando regime OK + na zona + volatilidade OK

**Gatilho / ENTRY (15m):**
- **LONG**: Candle fecha acima da EMA21(15m) após pullback + Volume > VolumeMA20 + RSI <= 72
- **SHORT**: Candle fecha abaixo da EMA21(15m) + Volume > VolumeMA20 + RSI >= 28

**Stop Loss:**
- Maior entre: stop por estrutura (swing high/low) ou stop por ATR (1.2 * ATR14_15m)

**Targets:**
- T1 = entrada ± 1R
- T2 = entrada ± 2R

### 2. BREAKOUT_RETEST (Opcional)

**Condições:**
- Só LONG se regime 1H for bullish; só SHORT se bearish
- Breakout: romper máxima/mínima das últimas N velas (padrão: 48)
- Volume acima da média no breakout
- Reteste: preço volta ao nível rompido (tolerância ±0.3*ATR15m) e confirma

## Sistema de Score

O score vai de 0 a 10. Apenas alertas com score >= 7 (configurável) são emitidos como ENTRY.

**Componentes do Score:**
- +2: Regime forte (EMA200 + inclinação)
- +2: Zona limpa (distância pequena da EMA21_1H)
- +2: Gatilho claro (fechamento na direção e candle "forte")
- +2: Volume acima da média no gatilho
- +2: R:R estimado >= 2

## Filtros Anti-Trade Ruim

### Filtro de Liquidez
- Top 50 símbolos por quoteVolume 24h
- Volume mínimo configurável (padrão: 0)

### Filtro de Volatilidade
- ATR%15m = ATR14(15m) / preço
- Ignora se ATR% < 0.3% (moeda morta) ou ATR% > 2.5% (serrilha)
- Limites configuráveis

## Como Usar

### Via Interface Web

1. Acesse `/scanner-aplus` após fazer login
2. Configure os parâmetros (opcional)
3. Clique em "Executar Scanner"
4. Visualize os alertas ENTRY e PRE-SETUP

### Via API

```typescript
// GET request
GET /api/scanner-aplus?minEntryScore=7&topNAlerts=3

// POST request
POST /api/scanner-aplus
{
  "config": {
    "topSymbolsLimit": 50,
    "minATRPercent": 0.3,
    "maxATRPercent": 2.5,
    "minEntryScore": 7,
    "topNAlerts": 3,
    "enableBreakoutRetest": false
  }
}
```

### Via Código

```typescript
import { runScanner } from '@/lib/scannerAplus';

const result = await runScanner({
  topSymbolsLimit: 50,
  minEntryScore: 7,
  topNAlerts: 3,
});

console.log('Entries:', result.entries);
console.log('Pre-Setups:', result.preSetups);
```

## Configurações

| Parâmetro | Padrão | Descrição |
|-----------|--------|-----------|
| `topSymbolsLimit` | 50 | Número de símbolos a analisar |
| `minQuoteVolume` | 0 | Volume mínimo em USDT |
| `minATRPercent` | 0.3 | ATR% mínimo (filtra moedas mortas) |
| `maxATRPercent` | 2.5 | ATR% máximo (filtra serrilha) |
| `minEntryScore` | 7 | Score mínimo para ENTRY |
| `topNAlerts` | 3 | Top N alertas para retornar |
| `enableBreakoutRetest` | false | Habilitar setup BREAKOUT_RETEST |
| `breakoutPeriod` | 48 | Período para detectar breakout |
| `cooldownMinutes` | 60 | Cooldown entre alertas do mesmo símbolo |

## Gestão de Risco

O scanner inclui utilitários para calcular o tamanho da posição:

```typescript
import { calculatePositionSize, calculateRiskReward } from '@/lib/riskManagement';

// Calcular quantidade baseada em risco de 2%
const balance = 10000; // USDT
const riskPercent = 2;
const qty = calculatePositionSize(balance, riskPercent, entry, stop);

// Calcular R:R
const rr = calculateRiskReward(entry, stop, target);
```

## Estrutura de Resposta

```typescript
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
```

## Testes

Execute os testes simples:

```bash
tsx lib/scannerAplus.test.ts
```

## Cooldown

O scanner implementa um sistema de cooldown para evitar alertas repetidos:
- Por padrão: 60 minutos entre alertas do mesmo símbolo
- Configurável via `cooldownMinutes`

## Performance

- Análise de 50 símbolos leva aproximadamente 25-30 segundos
- Delay de 500ms entre requisições para não sobrecarregar a API da Binance
- Retorna apenas Top N alertas por score

## Notas Importantes

⚠️ **Disclaimer**: Este scanner é uma ferramenta de análise técnica. Não constitui aconselhamento financeiro. Sempre faça sua própria análise e gerencie o risco adequadamente.

- Os alertas são baseados em análise técnica e podem não ser precisos
- Sempre use stop loss e gerencie o risco
- O mercado de criptomoedas é altamente volátil
- Teste em conta demo antes de usar com dinheiro real



