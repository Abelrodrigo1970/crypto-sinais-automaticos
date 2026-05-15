# ⏰ Configuração do Cron Job Automático

O sistema está configurado para executar automaticamente a cada hora entre 8:00 e 23:59.

## Universos / scanners — crons opcionais (background)

Todos respondem já e correm o scan **em background** (evita timeout do Railway).

**Recomendado — um único cron:** `/api/cron/scan-scanners-all` agenda **Scanner 1 → 2 → 3** em **sequência** (menos sobrecarga na Binance do que disparar os 3 URLs ao mesmo tempo).

| Endpoint | Universo | Função |
|----------|-----------|--------|
| `/api/cron/scan-scanner-1-ma200` | `UNIVERSE_ABOVE_MA200_1H` | Scanner 1 — fecho **acima SMA200**, 1h |
| `/api/cron/scan-scanner-2-ma80` | `UNIVERSE_NEAR_MA200_PCT10_1H` | Scanner 2 — **±10%** SMA80, 1h |
| `/api/cron/scan-scanner-3-ma80` | `UNIVERSE_NEAR_MA200_PCT4_1H` | Scanner 3 — **±4%** SMA80, 1h |
| `/api/cron/scan-scanners-all` | os 3 códigos acima | **Todos** os scans, um após outro |

**cron-job.org (exemplo):**

- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET` (opcional; igual ao `run-signals`, se `CRON_SECRET` no Railway)

URLs de exemplo (troca pelo teu domínio):

- **Todos:** `https://crypto-sinais-automaticos-production.up.railway.app/api/cron/scan-scanners-all`
- `https://crypto-sinais-automaticos-production.up.railway.app/api/cron/scan-scanner-1-ma200`
- `https://crypto-sinais-automaticos-production.up.railway.app/api/cron/scan-scanner-2-ma80`
- `https://crypto-sinais-automaticos-production.up.railway.app/api/cron/scan-scanner-3-ma80`

**Alternativa manual (bloqueia até terminar):**

```http
GET /api/symbol-universes/scan?code=UNIVERSE_ABOVE_MA200_1H
GET /api/symbol-universes/scan?code=UNIVERSE_NEAR_MA200_PCT10_1H
GET /api/symbol-universes/scan?code=UNIVERSE_NEAR_MA200_PCT4_1H
```

---

## Endpoint principal (sinais)

| Endpoint | Estratégias | Tempo estimado | Cron-job.org |
|----------|-------------|----------------|--------------|
| `/api/cron/run-signals` | MACD Histogram, Multi-Timeframe, PMO, MACD+PMO, Afastamento médio, MA60 | ~10–15 min | Horário a hora (8h–23h) |

## Horários de Execução

- **8:00** - Primeira execução do dia
- **9:00** - Segunda execução
- **10:00** - Terceira execução
- ...
- **23:00** - Última execução do dia

**Total:** 16 execuções por dia (8:00 até 23:00)

## Configuração no cron-job.org (Recomendado)

### Passo 1: Criar Conta
1. Acesse: https://cron-job.org
2. Crie uma conta gratuita

### Passo 2: Criar o Cron Job

**Cron Job – Sinais:**
- **Title:** Crypto Sinais
- **URL:** `https://crypto-sinais-automaticos-production.up.railway.app/api/cron/run-signals`
- **Schedule:** `0 8-23 * * *` (every hour 8h–23h)
- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET` (se configurado)

### Passo 3: Testar
1. Clique em "Run now" para testar
2. Verifique os logs no Railway

## Configuração de Segurança (Opcional mas Recomendado)

### Adicionar CRON_SECRET no Railway

1. No Railway, vá em Settings → Environment Variables
2. Adicione:
   ```
   CRON_SECRET=seu-token-super-secreto-aqui
   ```
3. Use este token no header Authorization do cron-job.org

## Verificação Manual

**Todas as estratégias ativas:**
```
https://crypto-sinais-automaticos-production.up.railway.app/api/cron/run-signals
```

**Respostas esperadas:**
- ✅ **200 OK:** Executado com sucesso (se estiver entre 8:00-23:59)
- ⚠️ **200 OK (fora do horário):** Mensagem informando que está fora do horário
- ❌ **401:** Não autorizado (se CRON_SECRET estiver configurado e não fornecido)
- ❌ **500:** Erro na execução

## Alternativas ao cron-job.org

### Opção 1: EasyCron
- URL: https://www.easycron.com
- Similar ao cron-job.org
- Plano gratuito disponível

### Opção 2: UptimeRobot
- URL: https://uptimerobot.com
- Monitora e pode executar URLs
- Plano gratuito disponível

### Opção 3: GitHub Actions (se o código estiver no GitHub)
- Pode criar um workflow que executa a cada hora
- Gratuito para repositórios públicos

## Troubleshooting

### Erro 502 Bad Gateway / Cron desativado
- **Causa:** Timeout - o endpoint demorou demais (Railway ~60-300s)
- **Solução:** Aumente o timeout no plano do Railway, reduza universo de símbolos nas estratégias, ou espalhe cargas em horários diferentes se no futuro houver endpoints separados

### Cron não está executando
1. Verifique se o cron-job.org está ativo
2. Verifique os logs do cron-job.org
3. Verifique os logs do Railway
4. Teste manualmente a URL

### Erro 401 (Não autorizado)
- Verifique se o CRON_SECRET está configurado corretamente
- Verifique se o header Authorization está sendo enviado
