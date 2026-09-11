import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
export function middleware(request: NextRequest) { const protectedPath = request.nextUrl.pathname.startsWith('/workspace'); if (protectedPath && !request.cookies.has('lingke_session')) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url)); return NextResponse.next(); }
export const config = { matcher: ['/workspace/:path*'] };
