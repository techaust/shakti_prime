import { closeAuthDb } from '@shakti/db/auth';
import { ErrorEnvelope, ReadyResponse, type ReadyChecks } from '@shakti/contracts';
import { closeDb } from '@shakti/db';
import { closeOutboxDb } from '@shakti/db/outbox';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as clientAddressModule from '../src/auth/client-address';
import { defaultAuthDeps } from '../src/auth/deps';
import * as readiness from '../src/auth/readiness';
import { logger } from '../src/log';
import { GET } from '../src/app/api/v1/health/ready/route';

afterAll(async () => {
  await closeAuthDb();
  await closeOutboxDb();
  await closeDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ALL_OK: ReadyChecks = {
  database: 'ok',
  auth_database: 'ok',
  key_value: 'ok',
  config: 'ok',
  outbox: 'ok',
};

/** An address no other test used, so the per-address cap never carries over between tests. */
function address(): string {
  const part = () => Math.floor(Math.random() * 250) + 1;
  return `10.${String(part())}.${String(part())}.${String(part())}`;
}

const ready = (headers: Record<string, string> = {}) =>
  GET(new Request('http://localhost/api/v1/health/ready', { headers }));

describe('GET /api/v1/health/ready', () => {
  it('answers ok with the overall status only, and echoes the request id', async () => {
    const response = await ready({ 'x-request-id': 'r-1', 'x-forwarded-for': address() });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('r-1');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body: unknown = await response.json();
    expect(ReadyResponse.parse(body)).toEqual({ status: 'ok', time: expect.any(String) });
    expect(body).not.toHaveProperty('checks');
  });

  it('replaces a request id it cannot echo safely', async () => {
    const response = await ready({
      'x-request-id': 'bad id with spaces',
      'x-forwarded-for': address(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toMatch(/^[\w.-]+$/);
    expect(response.headers.get('x-request-id')).not.toBe('bad id with spaces');
  });

  it('answers 503 naming no dependency, and logs which one is down with the request id', async () => {
    vi.spyOn(readiness, 'checkReadiness').mockResolvedValue({ ...ALL_OK, key_value: 'down' });
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const response = await ready({ 'x-request-id': 'r-503', 'x-forwarded-for': address() });
    expect(response.status).toBe(503);
    const text = await response.text();
    const body = ErrorEnvelope.parse(JSON.parse(text));
    expect(body.error).toEqual({
      code: 'integration_unavailable',
      message: 'Something went wrong on our side. Please try again in a minute.',
      requestId: 'r-503',
    });
    for (const check of Object.keys(ALL_OK)) expect(text).not.toContain(check);
    expect(log).toHaveBeenCalledWith('warn', 'health.not_ready', {
      requestId: 'r-503',
      checks: { ...ALL_OK, key_value: 'down' },
    });
  });

  it('caps each address, answering 429 with the wait, without running the checks', async () => {
    const checks = vi.spyOn(readiness, 'checkReadiness').mockResolvedValue(ALL_OK);
    const busy = address();
    for (let i = 0; i < readiness.READY_CAP.max; i += 1) {
      expect((await ready({ 'x-forwarded-for': busy })).status).toBe(200);
    }
    const refused = await ready({ 'x-forwarded-for': busy });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe(String(readiness.READY_CAP.window));
    expect(ErrorEnvelope.parse(await refused.json()).error.code).toBe('rate_limited');
    expect(checks).toHaveBeenCalledTimes(readiness.READY_CAP.max);

    // Another address is counted on its own.
    expect((await ready({ 'x-forwarded-for': address() })).status).toBe(200);
  });

  it('counts callers whose address cannot be read under one shared cap', async () => {
    vi.spyOn(readiness, 'checkReadiness').mockResolvedValue(ALL_OK);
    vi.spyOn(clientAddressModule, 'clientAddress').mockReturnValue(undefined);
    for (let i = 0; i < readiness.READY_CAP.max; i += 1) {
      expect((await ready({ 'x-forwarded-for': address() })).status).toBe(200);
    }
    expect((await ready({ 'x-forwarded-for': address() })).status).toBe(429);
  });

  it('answers 503 without running the checks when the caller cannot be counted', async () => {
    const checks = vi.spyOn(readiness, 'checkReadiness');
    vi.spyOn(defaultAuthDeps().keyValue, 'incr').mockRejectedValue(new Error('store down'));
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const response = await ready({ 'x-request-id': 'r-store', 'x-forwarded-for': address() });
    expect(response.status).toBe(503);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe('integration_unavailable');
    expect(checks).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'warn',
      'health.not_ready',
      expect.objectContaining({ requestId: 'r-store', capUnavailable: true }),
    );
  });
});
