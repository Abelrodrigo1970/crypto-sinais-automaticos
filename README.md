# Ações Bybit · Sinais

Estratégias de trading e sinais automáticos para **ações e ETFs cotados como perpétuos USDT na Bybit**
(`symbolType` = `stock` / `ETF`, ex.: `AAPLUSDT`, `NVDAUSDT`, `SOXLUSDT`).

> Uso pessoal e educativo. Nada aqui é recomendação financeira.

## Como funciona

- `lib/marketData.ts`: API pública Bybit v5 (velas, preço, universo de ações/ETFs com volume 24h).
- `lib/underlyingData.ts`: velas diárias da ação subjacente (Yahoo Finance).
- `lib/strategies/`: uma estratégia por ficheiro (`StrategyDefinition`), registada em `lib/strategies/index.ts`.
- `lib/signalEngine.ts`: sincroniza o registo com a tabela `Strategy`, gere as posições abertas (saída / trailing stop) e abre novas no universo.
- `lib/update24hResults.ts`: fecha cada sinal ao fim de 24h com preço, máximo e mínimo.

Estratégias novas entram **inativas**; ativam-se na página **Estratégias**, onde também se editam os parâmetros.

### Estratégias

| Código | Estratégia | Entrada (fecho) | Saída (fecho) |
|---|---|---|---|
| `RSI2` | Connors RSI-2 | Preço > SMA200 e RSI(2) < 10 | Preço > SMA5 |
| `IBS` | IBS < 0.2 | (fecho − mínimo) / (máximo − mínimo) < 0,2 | Fecho > máximo da véspera |
| `RMA` | Rel. Momentum Accel | Impulso (EMA7 − KAMA30)/KAMA30 > média 7d + 1σ | Trailing stop: máximo desde a entrada − 3×ATR(7) |

- Só long, só ações com mais de 1M USDT de volume 24h; `excludeSymbols` retira as 12 ações que perderam em 2+ estratégias no backtest 01/2025–10/2026.
- Os sinais usam as **velas diárias da ação subjacente** (Yahoo, sessão regular, ajustadas a splits) — os mesmos dados do backtest; `lib/underlyingData.ts` valida o mapeamento comparando com o preço Bybit.
- Cada sinal é uma **posição** (`status` OPEN → CLOSED): entra ao preço Bybit no primeiro run depois do fecho e sai quando a regra de saída dispara (`exitPrice`, `resultPct`, `exitReason`).
- O código foi validado contra o backtest em Python: 651 de 652 trades idênticos (8 ações, 01/2025–10/2026).
- Correr `/api/cron/run-signals` de hora a hora chega (é idempotente); o importante é correr logo após o fecho de NY (20:00 UTC no verão, 21:00 UTC no inverno).

## Notas sobre os dados

- Os perpétuos de ações negociam 24/7; fora do horário de Wall Street o volume é muito baixo.
- Histórico disponível curto (os primeiros contratos são de ~abril 2026).
- Liquidez desigual: só ~60 dos ~270 ativos têm mais de 1M USDT de volume 24h. Usa `universe.minTurnover24h`.

## Endpoints

| Endpoint | Função |
|---|---|
| `GET /api/cron/run-signals` | Corre as estratégias ativas + fecho a 24h (em background). `Authorization: Bearer $CRON_SECRET` se definido |
| `POST /api/run-signals` | Igual, mas síncrono (botão do dashboard) |
| `GET /api/universe` | Universo atual de ações/ETFs Bybit |
| `GET/PUT /api/strategies` | Listar / ativar / mudar parâmetros |

## Desenvolvimento

```bash
npm install
DATABASE_URL=file:./dev.db npx prisma db push
DATABASE_URL=file:./dev.db npm run dev
```

Produção: Railway (Next.js + Postgres), deploy a partir de `main`.
