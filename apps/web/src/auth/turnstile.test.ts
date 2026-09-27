import { memoryLogger } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { verifyTurnstile } from './turnstile';

const answering = (body: unknown, status = 200) =>
  (() => Promise.resolve(Response.json(body, { status }))) as typeof fetch;

const base = {
  secretKey: 'a-real-looking-secret',
  expectedHostname: 'bos.example.in',
  expectedAction: 'sign-in',
};

describe('verifyTurnstile (AUDIT M37)', () => {
  it('passes a clear answer from the expected hostname and widget', async () => {
    const fetch = answering({ success: true, hostname: 'bos.example.in', action: 'sign-in' });
    await expect(verifyTurnstile('token', { ...base, fetch })).resolves.toBe('human');
  });

  it('refuses a missing token, a failed check, another hostname or another widget', async () => {
    const fetch = answering({ success: true, hostname: 'bos.example.in', action: 'sign-in' });
    await expect(verifyTurnstile('', { ...base, fetch })).resolves.toBe('bot');
    const logger = memoryLogger();
    await expect(
      verifyTurnstile('token', {
        ...base,
        logger,
        fetch: answering({ success: false, 'error-codes': ['invalid-input-response'] }),
      }),
    ).resolves.toBe('bot');
    expect(logger.entries[0]).toMatchObject({
      event: 'turnstile.refused',
      fields: { codes: ['invalid-input-response'] },
    });
    await expect(
      verifyTurnstile('token', {
        ...base,
        fetch: answering({ success: true, hostname: 'elsewhere.example', action: 'sign-in' }),
      }),
    ).resolves.toBe('bot');
    await expect(
      verifyTurnstile('token', {
        ...base,
        fetch: answering({ success: true, hostname: 'bos.example.in', action: 'contact' }),
      }),
    ).resolves.toBe('bot');
  });

  it('reports an unreachable, failing or slow Cloudflare as unavailable, not as a bot', async () => {
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    await expect(verifyTurnstile('token', { ...base, fetch: down })).resolves.toBe('unavailable');
    await expect(verifyTurnstile('token', { ...base, fetch: answering({}, 502) })).resolves.toBe(
      'unavailable',
    );
    const slow = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('timed out', 'TimeoutError'));
        });
      })) as typeof fetch;
    await expect(verifyTurnstile('token', { ...base, fetch: slow, timeoutMs: 20 })).resolves.toBe(
      'unavailable',
    );
  });

  it("does not check hostname and widget with Cloudflare's test secrets", async () => {
    await expect(
      verifyTurnstile('token', {
        ...base,
        secretKey: '1x0000000000000000000000000000000AA',
        fetch: answering({ success: true, hostname: 'example.com' }),
      }),
    ).resolves.toBe('human');
  });
});
