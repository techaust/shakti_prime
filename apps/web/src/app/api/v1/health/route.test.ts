import { HealthResponse } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { GET } from './route';

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
});
