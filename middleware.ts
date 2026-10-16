import { NextRequest, NextResponse } from 'next/server';

/**
 * Toda a app exige o ACCESS_CODE (cookie definido em /login), exceto:
 * /login, /api/login, /api/health e /api/cron/* (este protegido por CRON_SECRET).
 */
export const COOKIE = 'acc';

export async function accessToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`crypto-sinais:${code}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(request: NextRequest) {
  const code = process.env.ACCESS_CODE;
  if (!code) return NextResponse.next(); // desenvolvimento local sem código

  const cookie = request.cookies.get(COOKIE)?.value;
  if (cookie && cookie === (await accessToken(code))) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon\\.ico|login|api/login|api/health|api/cron/).*)'],
};
