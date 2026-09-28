import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestError } from './instrumentation';
import { logger } from './log';

type ErrorRequest = Parameters<typeof onRequestError>[1];
type ErrorContext = Parameters<typeof onRequestError>[2];

const context: ErrorContext = {
  routerKind: 'App Router',
  routePath: '/leads',
  routeType: 'render',
  renderSource: 'react-server-components',
  revalidateReason: undefined,
};

function failedRequest(headers: ErrorRequest['headers']): ErrorRequest {
  return { path: '/leads?page=2', method: 'GET', headers };
}

async function loggedRequestId(headers: ErrorRequest['headers']): Promise<unknown> {
  const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
  await onRequestError(new Error('render failed'), failedRequest(headers), context);
  const [, event, fields] = log.mock.calls.at(-1) ?? [];
  expect(event).toBe('request.failed');
  return fields?.requestId;
}

describe('onRequestError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logs the platform's request id ahead of one the caller chose", async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await expect(
      loggedRequestId({ 'x-vercel-id': 'bom1::abcde-1727430000000', 'x-request-id': 'mine' }),
    ).resolves.toBe('bom1::abcde-1727430000000');
  });

  it("logs a caller's id only when it is safe to write, and never a raw header", async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await expect(loggedRequestId({ 'x-request-id': 'monitor-7' })).resolves.toBe('monitor-7');
    await expect(
      loggedRequestId({ 'x-request-id': 'forged\n{"level":"info"}' }),
    ).resolves.toBeUndefined();
    await expect(loggedRequestId({ 'x-request-id': ['a', 'b'] })).resolves.toBeUndefined();
  });
});
