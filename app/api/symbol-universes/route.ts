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
    return NextResponse.json({ error: 'Erro ao listar universos' }, { status: 500 });
  }
}
