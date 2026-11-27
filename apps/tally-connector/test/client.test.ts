import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BosClient, BosRefused, BosUnavailable } from '../src/client';
import { createMemoryLog } from '../src/log';
import { signRequest, signedHeaders } from '../src/signing';
import { CONNECTOR_ID, FAST } from './harness';

// The vectors apps/web/src/integrations/tally/tally.test.ts verifies with the BOS's own verifier
// (`verifyConnectorRequest`): a change on either side fails one of the two.
const KEY = 'tally-connector-test-key-one';
const NOW = new Date('2026-09-28T06:00:00Z');

describe('signing', () => {
  it('signs as the BOS verifies: a batch, and a cursor read with its query', () => {
    expect(
      signRequest(KEY, {
        method: 'POST',
        pathWithQuery: '/api/v1/connector/tally/batches',
        timestamp: '1790575200',
        body: '{"company":"Shakti Supreme","fromAlterId":0}',
      }),
    ).toBe('08ba73cb388ad3c2d0689a1ebdf6556a21f464ad4a3c0f0cfb356c46160be804');
    expect(
      signedHeaders(
        CONNECTOR_ID,
        KEY,
        {
          method: 'GET',
          pathWithQuery: '/api/v1/connector/tally/cursor?company=Shakti+Supreme',
          body: '',
        },
        NOW,
      ),
    ).toEqual({
      'x-connector-id': CONNECTOR_ID,
      'x-timestamp': '1790575200',
      'x-signature': 'acb3706f74c2962b35ab2f1ea230ea46566c2c6a4ce0100e8ceac686290e63c6',
    });
  });
});

interface Call {
  url: string;
  init: RequestInit;
}

function client(answers: (() => Response)[], calls: Call[] = [], sleeps: number[] = []) {
  return new BosClient({
    baseUrl: 'https://bos.example/ignored/path',
    connectorId: CONNECTOR_ID,
    key: KEY,
    settings: { ...FAST, bosRetries: 2, bosBackoffMs: 100, bosMaxRetryAfterMs: 5_000 },
    log: createMemoryLog(),
    now: () => NOW,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    fetch: (input, init) => {
      calls.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        init: init ?? {},
      });
      const next = answers.shift();
      if (next === undefined) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(next());
    },
  });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const cursor = { company: 'Shakti Supreme', lastAlterId: 40, updatedAt: null };

describe('the BOS client', () => {
  it('signs the exact path and query it sends, and keeps the key out of every printout', async () => {
    const calls: Call[] = [];
    const c = client([() => json(200, cursor)], calls);
    await expect(c.cursor('Shakti Supreme')).resolves.toEqual(cursor);
    expect(calls[0]?.url).toBe(
      'https://bos.example/api/v1/connector/tally/cursor?company=Shakti+Supreme',
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-signature']).toBe(
      'acb3706f74c2962b35ab2f1ea230ea46566c2c6a4ce0100e8ceac686290e63c6',
    );
    expect(calls[0]?.init.redirect).toBe('error');
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect(inspect(c, { depth: 5, showHidden: true })).not.toContain(KEY);
  });

  it('sends a batch with its stored key and body, the same on every attempt', async () => {
    const calls: Call[] = [];
    const sleeps: number[] = [];
    const answer = {
      company: 'C',
      accepted: { vouchersNew: 1, vouchersChanged: 0, vouchersUnchanged: 0, ledgers: 0 },
      lastAlterId: 5,
    };
    const c = client([() => json(503, {}), () => json(200, answer)], calls, sleeps);
    await expect(c.sendBatch({ body: '{"x":1}', idempotencyKey: 'k-1' })).resolves.toEqual(answer);
    expect(
      calls.map((x) => [
        x.init.body,
        (x.init.headers as Record<string, string>)['idempotency-key'],
      ]),
    ).toEqual([
      ['{"x":1}', 'k-1'],
      ['{"x":1}', 'k-1'],
    ]);
    expect(sleeps).toEqual([100]);
  });

  it('waits as Retry-After asks, or for the next cycle when it asks too long', async () => {
    const sleeps: number[] = [];
    const c = client(
      [() => json(429, {}, { 'retry-after': '2' }), () => json(200, cursor)],
      [],
      sleeps,
    );
    await expect(c.cursor('C')).resolves.toEqual(cursor);
    expect(sleeps).toEqual([2_000]);

    const long = client([() => json(429, {}, { 'retry-after': '600' })]);
    await expect(long.cursor('C')).rejects.toEqual(new BosUnavailable('rate_limited'));
  });

  it('gives up after its retries, and never retries a refusal', async () => {
    const calls: Call[] = [];
    await expect(client([], calls).cursor('C')).rejects.toEqual(new BosUnavailable('network'));
    expect(calls).toHaveLength(3);

    const refused = client([
      () =>
        json(409, {
          error: {
            code: 'conflict',
            message: 'x',
            details: { reason: 'cursor_mismatch' },
            requestId: 'r',
          },
        }),
    ]);
    await expect(refused.sendBatch({ body: '{}', idempotencyKey: 'k' })).rejects.toEqual(
      new BosRefused(409, 'conflict', 'cursor_mismatch'),
    );
    await expect(client([() => json(200, { nonsense: true })]).cursor('C')).rejects.toEqual(
      new BosUnavailable('bad_answer'),
    );
  });
});
