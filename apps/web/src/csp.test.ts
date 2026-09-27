import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

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
});
