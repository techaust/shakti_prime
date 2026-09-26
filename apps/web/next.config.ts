import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Response headers for every route (docs/SECURITY.md §2). Turnstile is the one third-party
 * script and frame. Next.js needs inline scripts for hydration, so `script-src` allows them
 * until the nonce-based policy arrives with the app shell's proxy in week 4.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const config: NextConfig = {
  typedRoutes: true,
  transpilePackages: ['@shakti/contracts', '@shakti/db', '@shakti/domain', '@shakti/tokens'],
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  poweredByHeader: false,
  headers() {
    return Promise.resolve([
      { source: '/(.*)', headers: SECURITY_HEADERS },
      // The reset token travels in the query string: never leak it through a referrer.
      { source: '/set-password', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ]);
  },
};

export default withNextIntl(config);
