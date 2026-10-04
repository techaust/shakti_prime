import { AWS_DEFAULT_REGION } from './aws-region';

/** Cloudflare Turnstile: the one third-party script and frame. */
const TURNSTILE = 'https://challenges.cloudflare.com';

/**
 * The origin browser error reports go to, from the DSN (`NEXT_PUBLIC_SENTRY_DSN`), or undefined
 * without one or with one that is not an https address.
 */
export function sentryIngestOrigin(dsn: string | undefined): string | undefined {
  if (dsn === undefined || dsn.trim() === '') return undefined;
  try {
    const url = new URL(dsn.trim());
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Content-Security-Policy of a page (docs/SECURITY.md §2, AUDIT L43). Scripts run only with
 * this request's nonce (`'strict-dynamic'` lets those scripts load what they need, which is how
 * the Turnstile widget brings its own); no inline script without the nonce runs. Development
 * adds `'unsafe-eval'`, which React needs there to rebuild server error stacks. Inline styles stay
 * allowed: pages set colours and sizes through `style`, which a nonce cannot cover. The browser
 * may send error reports to Sentry's ingest host only when a DSN names one (`sentryOrigin`).
 * `fileOrigins` adds the origins a page uploads to directly (the environment's file bucket).
 */
export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  sentryOrigin?: string,
  fileOrigins: readonly string[] = [],
): string {
  const connect = [
    TURNSTILE,
    ...(sentryOrigin === undefined ? [] : [sentryOrigin]),
    ...fileOrigins,
  ].join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE}${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${connect}`,
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

/**
 * The origin a browser uploads files to when the S3 store is configured (docs/ARCHITECTURE.md
 * §9): the bucket's own address in its region, which signed addresses name. None locally, where
 * uploads go to the app itself.
 */
export function fileUploadOrigins(env: Readonly<Record<string, string | undefined>>): string[] {
  const bucket = env.FILES_BUCKET ?? '';
  if (bucket === '' || (env.FILES_KMS_KEY_ID ?? '') === '') return [];
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return [];
  const region = (env.AWS_REGION ?? '') === '' ? AWS_DEFAULT_REGION : String(env.AWS_REGION);
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) return [];
  return [`https://${bucket}.s3.${region}.amazonaws.com`];
}
