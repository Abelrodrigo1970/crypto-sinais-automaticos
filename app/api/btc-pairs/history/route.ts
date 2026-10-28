import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Listas semanais guardadas (sem os pares), mais recente primeiro */
export async function GET() {
  const rows = await prisma.btcPairsSnapshot.findMany({
    orderBy: { takenAt: 'desc' },
    select: { id: true, takenAt: true, btcPrice: true, count: true },
  });
  return NextResponse.json({ snapshots: rows });
}
