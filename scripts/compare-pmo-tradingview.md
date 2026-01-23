# Comparação: Nossa Implementação vs TradingView PMO

## Código TradingView fornecido:
```pinescript
[pmo, signal] = TVta.pmo(sourceInput, length1Input, length2Input, signalInput)
```

## Nossa Implementação Atual:

```typescript
// 1. ROC(35) = (preço[i] - preço[i-35]) / preço[i-35] × 100
const roc: number[] = [];
for (let i = rocPeriod; i < closes.length; i++) {
  const change = ((closes[i] - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100;
  roc.push(change);
}

// 2. EMA(20) aplicada no ROC
const emaFastValues = EMA.calculate({
  values: roc,
  period: emaFast, // 20
});

// 3. EMA(10) aplicada no resultado da EMA(20)
const emaSlowValues = EMA.calculate({
  values: emaFastValues,
  period: emaSlow, // 10
});

// 4. PMO = (EMA20 - EMA10) × 10
const pmo = (lastFast - lastSlow) * 10;
```

## Diferenças Potenciais:

1. **Tipo de EMA**: TradingView pode usar EMA com fator personalizado (2/length) em vez de 2/(n+1)
2. **Signal Line**: TradingView retorna também a signal line (EMA do PMO), que não estamos calculando
3. **Precisão**: Pode haver diferenças de arredondamento

## Fórmula Padrão PMO (conforme documentação):

1. ROC(period) = (preço atual - preço N períodos atrás) / preço N períodos atrás × 100
2. EMA(length2) aplicada no ROC
3. EMA(signal) aplicada no resultado da primeira EMA
4. PMO = (EMA_fast - EMA_slow) × 10
5. Signal = EMA do PMO (geralmente EMA de 10 períodos do PMO)

## Conclusão:

Nossa implementação parece estar correta, mas:
- Não calculamos a signal line
- Pode haver diferenças sutis no tipo de EMA usado
- Os valores devem ser muito próximos, mas podem ter pequenas diferenças
