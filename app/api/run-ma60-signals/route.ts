import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchSymbolsWithMarketCap, runMa60CrossoverStrategy } from '@/lib/signalEngine';

export async function POST(request: NextRequest) {
  console.log('📡 Endpoint /api/run-ma60-signals chamado');
  try {
    // Verifica autenticação
    if (!(await isAuthenticated())) {
      console.log('❌ Autenticação falhou');
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
    console.log('✅ Autenticação OK');

    // Buscar estratégia MA60_CROSSOVER
    console.log('🔍 Buscando estratégia MA60_CROSSOVER...');
    let strategy = await prisma.strategy.findFirst({
      where: { 
        name: 'MA60_CROSSOVER',
      },
    });

    // Se não encontrou, tentar criar (caso o seed não tenha rodado)
    if (!strategy) {
      console.log('⚠️ Estratégia MA60_CROSSOVER não encontrada. Tentando criar...');
      try {
        strategy = await prisma.strategy.create({
          data: {
            name: 'MA60_CROSSOVER',
            displayName: 'MA60 Crossover 1h',
            description:
              'Gera sinais quando o preço cruza a média móvel de 60 períodos. COMPRA: preço cruza acima da MA60. VENDA: preço cruza abaixo da MA60. Timeframe 1h - sinais de hora a hora. Apenas para símbolos com market cap > 70 milhões.',
            isActive: true,
            params: JSON.stringify({
              maPeriod: 60,
            }),
          },
        });
        console.log('✅ Estratégia MA60_CROSSOVER criada com sucesso');
      } catch (error) {
        console.error('❌ Erro ao criar estratégia:', error);
        return NextResponse.json({
          error: 'Estratégia MA60_CROSSOVER não encontrada e não foi possível criar. Execute o seed do banco de dados.',
          details: error instanceof Error ? error.message : 'Erro desconhecido',
        }, { status: 404 });
      }
    } else {
      console.log(`✅ Estratégia encontrada: ${strategy.displayName} (ativa: ${strategy.isActive})`);
    }

    if (!strategy.isActive) {
      console.log('⚠️ Estratégia está inativa');
      return NextResponse.json({
        error: 'Estratégia MA60_CROSSOVER está inativa',
      }, { status: 400 });
    }

    const params = JSON.parse(strategy.params || '{}');
    let signalsCreated = 0;

    // Buscar símbolos com market cap > 70 milhões (como a estratégia faz)
    const symbols = await fetchSymbolsWithMarketCap(70000000);
    
    console.log(`📊 Executando estratégia MA60 para ${symbols.length} símbolos...`);

    // Executar apenas para timeframe 1h
    const timeframe = '1h' as const;

    for (const symbol of symbols) {
      try {
        const signalResult = await runMa60CrossoverStrategy(symbol, timeframe, params);
        
        if (signalResult) {
          console.log(`✅ MA60 sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
          
          // Verificar se já existe um sinal similar recente (dentro de 2 horas)
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          const existingSignal = await prisma.signal.findFirst({
            where: {
              symbol,
              strategyId: strategy.id,
              direction: signalResult.direction,
              generatedAt: {
                gte: twoHoursAgo,
              },
            },
          });

          if (existingSignal) {
            console.log(`⏭️  Sinal duplicado ignorado: ${symbol} ${signalResult.direction}`);
            continue;
          }

          // Criar o sinal
          await prisma.signal.create({
            data: {
              symbol,
              direction: signalResult.direction,
              timeframe,
              strategyId: strategy.id,
              strategyName: strategy.displayName,
              entryPrice: signalResult.entryPrice,
              stopLoss: signalResult.stopLoss,
              target1: signalResult.target1,
              target2: signalResult.target2,
              target3: signalResult.target3,
              strength: signalResult.strength,
              status: 'NEW',
              extraInfo: signalResult.extraInfo,
            },
          });

          signalsCreated++;
        }
        
        // Pequeno delay para não sobrecarregar a API
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Erro ao processar ${symbol}:`, error);
        // Continua com o próximo símbolo
      }
    }

    console.log(`✅ Estratégia MA60 concluída: ${signalsCreated} novo(s) sinal(is) gerado(s)`);

    return NextResponse.json({
      success: true,
      signalsCreated,
      message: `${signalsCreated} novo(s) sinal(is) MA60 gerado(s)`,
    });
  } catch (error) {
    console.error('Erro ao executar estratégia MA60:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao gerar sinais MA60',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
