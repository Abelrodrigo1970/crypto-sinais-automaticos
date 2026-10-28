import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Uma lista semanal com todos os pares */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const row = await prisma.btcPairsSnapshot.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: 'Lista não encontrada' }, { status: 404 });
  return NextResponse.json({
    id: row.id,
    takenAt: row.takenAt.toISOString(),
    btcPrice: row.btcPrice,
    count: row.count,
    pairs: JSON.parse(row.data),
  });
}
