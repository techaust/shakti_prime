/** Cloudflare Turnstile: the one third-party script and frame. */
const TURNSTILE = 'https://challenges.cloudflare.com';

/**
 * The Content-Security-Policy of a page (docs/SECURITY.md §2, AUDIT L43). Scripts run only with
 * this request's nonce (`'strict-dynamic'` lets those scripts load what they need, which is how
 * the Turnstile widget brings its own); no inline script without the nonce runs. Development
 * adds `'unsafe-eval'`, which React needs there to rebuild server error stacks. Inline styles stay
 * allowed: pages set colours and sizes through `style`, which a nonce cannot cover.
 */
export function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE}${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${TURNSTILE}`,
    `frame-src ${TURNSTILE}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** For JSON routes, which load nothing at all. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";
