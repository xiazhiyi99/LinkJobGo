import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
export function middleware(request: NextRequest) {
  const cookieName = process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME || 'lingke_session';
  if (request.nextUrl.pathname.startsWith('/workspace') && !request.cookies.has(cookieName)) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    login.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/workspace/:path*'] };
