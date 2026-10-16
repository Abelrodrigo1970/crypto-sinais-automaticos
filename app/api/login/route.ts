import { NextRequest, NextResponse } from 'next/server';
import { COOKIE, accessToken } from '@/middleware';

export async function POST(request: NextRequest) {
  const { code } = await request.json().catch(() => ({ code: '' }));
  const expected = process.env.ACCESS_CODE;
  if (!expected || typeof code !== 'string' || code !== expected) {
    await new Promise((r) => setTimeout(r, 800)); // trava tentativas em série
    return NextResponse.json({ error: 'Código de acesso errado' }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, await accessToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
