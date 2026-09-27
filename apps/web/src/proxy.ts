import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './csp';

/**
 * Gives every page request a fresh nonce and the Content-Security-Policy that trusts it
 * (AUDIT L43). Next.js adds the nonce to its own scripts from the request header; a page reads it
 * through `requestNonce()` for scripts it loads itself.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: JSON routes, static files and prefetches take the fixed headers.
      source: '/((?!api|_next/static|_next/image|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
