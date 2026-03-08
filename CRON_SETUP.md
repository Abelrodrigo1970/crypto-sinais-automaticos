# ⏰ Configuração do Cron Job Automático

O sistema está configurado para executar automaticamente a cada hora entre 8:00 e 23:59.

## Endpoints disponíveis

| Endpoint | Estratégias | Tempo estimado | Uso recomendado |
|----------|-------------|----------------|-----------------|
| `/api/cron/run-volume-spike` | Apenas Volume Spike | ~2-4 min | ✅ **Cron hora a hora** (evita timeout) |
| `/api/cron/run-signals` | Todas (MACD, MA60, Volume Spike, etc.) | ~20-35 min | Manual ou cron menos frequente |

**Importante:** Use `/api/cron/run-volume-spike` para o cron-job.org. O endpoint completo pode causar 502 Bad Gateway (timeout).

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

### Passo 2: Criar Cron Job
1. Clique em "Create cronjob"
2. Configure:
   - **Title:** Crypto Sinais - Volume Spike
   - **Address (URL):** `https://crypto-sinais-automaticos-production.up.railway.app/api/cron/run-volume-spike`
   - **Schedule:** Custom → Cron Expression: `0 8-23 * * *`
   - **OU** "Every hour" (de 8h até 23h)
   - **Request method:** GET
   - **Request headers (se CRON_SECRET configurado):**
     ```
     Authorization: Bearer seu-token-secreto
     ```

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

**Volume Spike (recomendado para cron):**
```
https://crypto-sinais-automaticos-production.up.railway.app/api/cron/run-volume-spike
```

**Todas as estratégias:**
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
- **Solução:** Use `/api/cron/run-volume-spike` em vez de `/api/cron/run-signals`
- Reative o cron no cron-job.org e altere a URL

### Cron não está executando
1. Verifique se o cron-job.org está ativo
2. Verifique os logs do cron-job.org
3. Verifique os logs do Railway
4. Teste manualmente a URL

### Erro 401 (Não autorizado)
- Verifique se o CRON_SECRET está configurado corretamente
- Verifique se o header Authorization está sendo enviado

### Executa fora do horário
- Verifique o timezone do servidor
- O código usa UTC por padrão
- Ajuste o horário no cron-job.org se necessário

