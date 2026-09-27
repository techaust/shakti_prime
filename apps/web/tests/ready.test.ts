import { ErrorEnvelope, ReadyResponse } from '@shakti/contracts';
import { closeDb } from '@shakti/db';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as readiness from '../src/auth/readiness';
import { GET } from '../src/app/api/v1/health/ready/route';

afterAll(closeDb);
afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/v1/health/ready', () => {
  it('reports every dependency as ok and echoes the request id', async () => {
    const response = await GET(
      new Request('http://localhost/api/v1/health/ready', { headers: { 'x-request-id': 'r-1' } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('r-1');
    const body = ReadyResponse.parse(await response.json());
    expect(body.checks).toEqual({
      database: 'ok',
      auth_database: 'ok',
      key_value: 'ok',
      config: 'ok',
    });
  });

  it('replaces a request id it cannot echo safely', async () => {
    const response = await GET(
      new Request('http://localhost/api/v1/health/ready', {
        headers: { 'x-request-id': 'bad id with spaces' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toMatch(/^[\w.-]+$/);
    expect(response.headers.get('x-request-id')).not.toBe('bad id with spaces');
  });

  it('answers 503 with the error envelope and the failing check (AUDIT L11)', async () => {
    vi.spyOn(readiness, 'checkReadiness').mockResolvedValue({
      database: 'ok',
      auth_database: 'ok',
      key_value: 'down',
      config: 'ok',
    });
    const response = await GET(new Request('http://localhost/api/v1/health/ready'));
    expect(response.status).toBe(503);
    const body = ErrorEnvelope.parse(await response.json());
    expect(body.error).toMatchObject({
      code: 'integration_unavailable',
      details: { checks: { key_value: 'down' } },
    });
  });
});
