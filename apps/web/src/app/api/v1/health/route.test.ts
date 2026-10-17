import { HealthResponse } from '@shakti/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/v1/health', () => {
  it('answers ok with a UTC timestamp and no caching', async () => {
    // The answer's time is read between these two, whatever the machine's speed.
    const before = Date.now();
    const response = GET();
    const after = Date.now();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = HealthResponse.parse(await response.json());
    expect(body.status).toBe('ok');
    expect(body.time).toMatch(/Z$/);
    const time = new Date(body.time).getTime();
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
  });

  it('names the commit Vercel built the deployment from, which a release compares', async () => {
    const sha = '485a43eb0c1f6d2e9b7a3c5d8e1f2a4b6c9d0e7f';
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', sha);
    expect(HealthResponse.parse(await GET().json()).commit).toBe(sha);
  });

  it('names no commit off Vercel, or for a value that is not a full commit', async () => {
    for (const value of ['', '485a43e', 'not a commit', 'A'.repeat(40)]) {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', value);
      expect(HealthResponse.parse(await GET().json()).commit).toBeNull();
    }
  });
});
