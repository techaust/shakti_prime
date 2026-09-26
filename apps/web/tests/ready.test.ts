import { ReadyResponse } from '@shakti/contracts';
import { closeDb } from '@shakti/db';
import { afterAll, describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/v1/health/ready/route';

afterAll(closeDb);

describe('GET /api/v1/health/ready', () => {
  it('reports the database as ok and echoes the request id', async () => {
    const response = await GET(
      new Request('http://localhost/api/v1/health/ready', { headers: { 'x-request-id': 'r-1' } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('r-1');
    const body = ReadyResponse.parse(await response.json());
    expect(body.checks.database).toBe('ok');
  });
});
