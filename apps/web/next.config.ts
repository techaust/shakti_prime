import { withSentryConfig } from '@sentry/nextjs/config';
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
  // Chromium's driver and the serverless Chromium build load files beside their own code at run
  // time, so they stay plain packages rather than bundled (ADR 0009); so does PDFium, which loads its
  // WebAssembly beside its code.
  serverExternalPackages: [
    'postgres',
    '@node-rs/argon2',
    'playwright-core',
    '@sparticuz/chromium',
    '@hyzyla/pdfium',
  ],
  // The serverless Chromium (`bin/*.br`, unpacked on a cold start) and the print fonts go only with
  // the render route, the one function that prints on a hosted runtime (docs/runbooks/DEPLOY.md).
  // The package finds `bin` beside its own real path in pnpm's store, so that path is the one
  // traced: the link under the app's node_modules would not be followed if the function's files
  // were copied as plain files.
  outputFileTracingIncludes: {
    '/api/v1/workers/pdf/render': [
      '../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**',
      './src/print/fonts/**',
    ],
  },
  // No body limit is raised: every file, an import file included, goes straight to the file store
  // on a pre-signed address (docs/API.md §3.2), so server actions keep Next.js's default.
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
