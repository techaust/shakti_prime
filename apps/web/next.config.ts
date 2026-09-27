import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { API_CONTENT_SECURITY_POLICY } from './src/csp';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Response headers for every route (docs/SECURITY.md §2). A page's Content-Security-Policy carries
 * a per-request nonce and is set by `src/proxy.ts`; the JSON routes, which load nothing, get a
 * fixed one here.
 */
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const config: NextConfig = {
  typedRoutes: true,
  transpilePackages: [
    '@shakti/contracts',
    '@shakti/db',
    '@shakti/domain',
    '@shakti/tokens',
    '@shakti/ui',
  ],
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  poweredByHeader: false,
  headers() {
    return Promise.resolve([
      { source: '/(.*)', headers: SECURITY_HEADERS },
      {
        source: '/api/(.*)',
        headers: [{ key: 'Content-Security-Policy', value: API_CONTENT_SECURITY_POLICY }],
      },
      // The reset token travels in the query string: never leak it through a referrer.
      { source: '/set-password', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ]);
  },
};

export default withNextIntl(config);
