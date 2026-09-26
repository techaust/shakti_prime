import { HealthResponse } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/v1/health', () => {
  it('answers ok with a UTC timestamp and no caching', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = HealthResponse.parse(await response.json());
    expect(body.status).toBe('ok');
    expect(new Date(body.time).getTime()).toBeCloseTo(Date.now(), -3);
  });
});
