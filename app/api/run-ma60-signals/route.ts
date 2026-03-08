import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runVolumeSpikeStrategy } from '@/lib/signalEngine';
import { fetchTopSymbolsByVolume } from '@/lib/marketData';

export async function POST(request: NextRequest) {
  console.log('📡 Endpoint /api/run-ma60-signals chamado (Volume Spike)');
  try {
    // Verifica autenticação
    if (!(await isAuthenticated())) {
      console.log('❌ Autenticação falhou');
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
    console.log('✅ Autenticação OK');

    // Buscar estratégia VOLUME_SPIKE
    console.log('🔍 Buscando estratégia VOLUME_SPIKE...');
    let strategy = await prisma.strategy.findFirst({
      where: { 
        name: 'VOLUME_SPIKE',
      },
    });

    // Se não encontrou, tentar criar (caso o seed não tenha rodado)
    if (!strategy) {
      console.log('⚠️ Estratégia VOLUME_SPIKE não encontrada. Tentando criar...');
      try {
        strategy = await prisma.strategy.create({
          data: {
            name: 'VOLUME_SPIKE',
            displayName: 'Volume Spike 1h',
            description:
              'Gera sinais quando o volume do último candle fechado é maior que 6 vezes a média das últimas 20 horas. COMPRA: volume spike com preço a subir. VENDA: volume spike com preço a descer. Timeframe 1h.',
            isActive: true,
            params: JSON.stringify({
              volumeMultiplier: 6,
              lookbackHours: 20,
            }),
          },
        });
        console.log('✅ Estratégia VOLUME_SPIKE criada com sucesso');
      } catch (error) {
        console.error('❌ Erro ao criar estratégia:', error);
        return NextResponse.json({
          error: 'Estratégia VOLUME_SPIKE não encontrada e não foi possível criar. Execute o seed do banco de dados.',
          details: error instanceof Error ? error.message : 'Erro desconhecido',
        }, { status: 404 });
      }
    } else {
      console.log(`✅ Estratégia encontrada: ${strategy.displayName} (ativa: ${strategy.isActive})`);
    }

    if (!strategy.isActive) {
      console.log('⚠️ Estratégia está inativa');
      return NextResponse.json({
        error: 'Estratégia VOLUME_SPIKE está inativa',
      }, { status: 400 });
    }

    const params = JSON.parse(strategy.params || '{}');
    let signalsCreated = 0;

    // Buscar símbolos por volume 24h (como a estratégia faz)
    const symbols = await fetchTopSymbolsByVolume(500, 100000);
    
    console.log(`📊 Executando estratégia Volume Spike para ${symbols.length} símbolos...`);

    // Executar apenas para timeframe 1h
    const timeframe = '1h' as const;

    for (const symbol of symbols) {
      try {
        const signalResult = await runVolumeSpikeStrategy(symbol, timeframe, params);
        
        if (signalResult) {
          console.log(`✅ Volume Spike sinal encontrado: ${symbol} ${signalResult.direction} (${timeframe})`);
          
          // Verificar se já existe um sinal similar recente (dentro de 2 horas)
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          const existingSignal = await prisma.signal.findFirst({
            where: {
              symbol,
              strategyId: strategy.id,
              timeframe,
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

    console.log(`✅ Estratégia Volume Spike concluída: ${signalsCreated} novo(s) sinal(is) gerado(s)`);

    return NextResponse.json({
      success: true,
      signalsCreated,
      message: `${signalsCreated} novo(s) sinal(is) Volume Spike gerado(s)`,
    });
  } catch (error) {
    console.error('Erro ao executar estratégia Volume Spike:', error);
    return NextResponse.json(
      {
        error: 'Ocorreu um erro ao gerar sinais Volume Spike',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
