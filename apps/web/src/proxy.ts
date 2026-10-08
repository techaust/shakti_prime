import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, fileUploadOrigins, sentryIngestOrigin } from './csp';
import { needsSignIn } from './session-gate';

/**
 * Runs before every page request. A BOS screen asked for without a session cookie goes to
 * sign-in at once (ARCHITECTURE §4; only the cookie's presence is checked here, the full check
 * stays in the `(bos)` layout and `currentPrincipal()`). Every other page gets a fresh nonce and
 * the Content-Security-Policy that trusts it (AUDIT L43): Next.js adds the nonce to its own
 * scripts from the request header; a page reads it through `requestNonce()` for scripts it loads
 * itself.
 */
export function proxy(request: NextRequest): NextResponse {
  if (needsSignIn(request.nextUrl.pathname, (name) => request.cookies.get(name)?.value)) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === 'development',
    sentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN),
    fileUploadOrigins(process.env),
  );
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
      // Pages only: JSON routes, static files (the push service worker among them) and
      // prefetches take the fixed headers.
      source: '/((?!api|_next/static|_next/image|icon.svg|push-sw.js).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
