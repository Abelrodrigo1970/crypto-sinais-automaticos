# 🚀 Crypto Sinais Automáticos

Sistema web completo para geração automática de sinais de compra e venda de criptomoedas baseado em indicadores técnicos.

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.7-2D3748)](https://www.prisma.io/)

## ⚠️ AVISO IMPORTANTE

**Este site é apenas para uso pessoal e educativo. Nada aqui é recomendação financeira. Não tomes decisões de investimento com base apenas nestes sinais.**

## 🚀 Instalação

1. Instale as dependências:
```bash
npm install
```

2. Configure as variáveis de ambiente:
```bash
cp .env.example .env
```

Edite o arquivo `.env` e defina:
- `DATABASE_URL`: URL do banco de dados SQLite
- `ACCESS_CODE`: Código de acesso para login

3. Configure o banco de dados:
```bash
npm run db:push
npm run db:generate
npm run db:seed
```

4. Inicie o servidor de desenvolvimento:
```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000)

## 📋 Funcionalidades

- Geração automática de sinais baseados em indicadores técnicos (RSI, MA Crossover, MACD, etc.)
- Dashboard com lista de sinais e filtros
- Gerenciamento de estratégias (ativar/desativar, ajustar parâmetros)
- Histórico de sinais
- Detalhes de cada sinal

## 🛠️ Tecnologias

- **Framework:** Next.js 14 (App Router)
- **Linguagem:** TypeScript
- **Estilos:** Tailwind CSS
- **Banco de Dados:** Prisma + SQLite
- **Indicadores:** Technical Indicators Library
- **API de Dados:** Binance Futures USDⓈ-M API

## 📊 Estratégias Implementadas

- **RSI (Relative Strength Index):** Sinais baseados em sobrecompra/sobrevenda
- **MA Crossover:** Cruzamento de médias móveis
- **MACD:** Moving Average Convergence Divergence

## 🔧 Scripts Disponíveis

```bash
npm run dev          # Inicia servidor de desenvolvimento
npm run build        # Cria build de produção
npm run start        # Inicia servidor de produção
npm run db:push      # Sincroniza schema com banco de dados
npm run db:generate  # Gera cliente Prisma
npm run db:seed      # Popula banco com estratégias iniciais
npm run db:studio    # Abre Prisma Studio (interface visual do banco)
```

## 📝 Licença

Este projeto é para uso pessoal e educativo.

