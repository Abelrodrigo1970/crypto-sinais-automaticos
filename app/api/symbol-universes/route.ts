import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** Lista universos de símbolos (Scanner 1 / 2) para UI e estratégias */
export async function GET() {
  try {
    const universes = await prisma.symbolUniverse.findMany({
      orderBy: { code: 'asc' },
    });
    return NextResponse.json({ universes });
  } catch (error) {
    console.error('Erro ao listar universos:', error);
    return NextResponse.json({
      universes: [],
      warning:
        'Tabela SymbolUniverse inexistente nesta BD. Executa `npx prisma db push` no deploy e corre o seed dos universos.',
      details: error instanceof Error ? error.message : undefined,
    });
  }
}
