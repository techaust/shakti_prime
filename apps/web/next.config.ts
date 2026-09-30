import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { API_CONTENT_SECURITY_POLICY } from './src/csp';
import { UPLOAD_BODY_LIMIT } from './src/files/limits';

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
  experimental: {
    // An import file reaches its server action as a form (docs/design/backend-weeks-3-5.md §8),
    // through the proxy, which would otherwise cut the body at 10 MB.
    serverActions: { bodySizeLimit: UPLOAD_BODY_LIMIT },
    proxyClientMaxBodySize: UPLOAD_BODY_LIMIT,
  },
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

/**
 * Source maps go to Sentry at build time only when `SENTRY_AUTH_TOKEN` is set (a hosted build),
 * named by the commit like the events, and are deleted from the output after the upload. Without
 * the token the build is not wrapped at all, so a local or CI build carries nothing of Sentry's
 * and needs none of its variables. Sentry itself starts at run time only with a DSN
 * (`src/instrumentation.ts`, `src/observability`).
 */
function withSentry(next: NextConfig): NextConfig {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  if (authToken === undefined || authToken.trim() === '') return next;
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  return withSentryConfig(next, {
    ...(org === undefined || org === '' ? {} : { org }),
    ...(project === undefined || project === '' ? {} : { project }),
    authToken,
    silent: true,
    telemetry: false,
    ...(commit === undefined || commit === '' ? {} : { release: { name: commit } }),
    sourcemaps: { deleteSourcemapsAfterUpload: true },
  });
}

export default withSentry(withNextIntl(config));
