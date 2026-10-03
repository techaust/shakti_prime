import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, fileUploadOrigins, sentryIngestOrigin } from './csp';

describe('Content-Security-Policy (AUDIT L43)', () => {
  it('runs only scripts that carry this request nonce, and never inline ones without it', () => {
    const csp = contentSecurityPolicy('bm9uY2U=', false);
    const scripts = csp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(scripts).toContain("'nonce-bm9uY2U='");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("allows eval only in development, where React's error stacks need it", () => {
    expect(contentSecurityPolicy('n', true)).toContain("'unsafe-eval'");
  });

  it('lets the browser reach Sentry only when a DSN names its ingest host', () => {
    const connect = (csp: string) => csp.split('; ').find((d) => d.startsWith('connect-src'));
    expect(connect(contentSecurityPolicy('n', false))).toBe(
      "connect-src 'self' https://challenges.cloudflare.com",
    );
    const origin = sentryIngestOrigin('https://publickey@o4501.ingest.us.sentry.io/4502');
    expect(origin).toBe('https://o4501.ingest.us.sentry.io');
    expect(connect(contentSecurityPolicy('n', false, origin))).toBe(
      "connect-src 'self' https://challenges.cloudflare.com https://o4501.ingest.us.sentry.io",
    );
  });

  it('opens nothing for a missing, empty or plain-http DSN', () => {
    for (const dsn of [undefined, '', '  ', 'http://key@sentry.local/1', 'not a dsn']) {
      expect(sentryIngestOrigin(dsn)).toBeUndefined();
    }
  });
});

describe('the file bucket in the page policy', () => {
  it('lets a page upload to the environment’s bucket only when S3 is configured', () => {
    expect(fileUploadOrigins({})).toEqual([]);
    expect(fileUploadOrigins({ FILES_BUCKET: 'shakti-prime-dev-files' })).toEqual([]);
    const origins = fileUploadOrigins({
      FILES_BUCKET: 'shakti-prime-dev-files',
      FILES_KMS_KEY_ID: 'alias/shakti-prime-dev-files',
    });
    expect(origins).toEqual(['https://shakti-prime-dev-files.s3.ap-south-1.amazonaws.com']);
    expect(contentSecurityPolicy('n', false, undefined, origins)).toContain(
      "connect-src 'self' https://challenges.cloudflare.com https://shakti-prime-dev-files.s3.ap-south-1.amazonaws.com",
    );
  });

  it('never writes a name that could widen the policy', () => {
    expect(
      fileUploadOrigins({ FILES_BUCKET: "x; script-src 'unsafe-inline'", FILES_KMS_KEY_ID: 'k' }),
    ).toEqual([]);
    expect(
      fileUploadOrigins({ FILES_BUCKET: 'ok-bucket', FILES_KMS_KEY_ID: 'k', AWS_REGION: 'x y' }),
    ).toEqual([]);
  });
});
