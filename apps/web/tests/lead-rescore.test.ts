import { ErrorEnvelope, LeadRescoreWorkerResponse, newId } from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { closeDb } from '@shakti/db/testing';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The nightly lead rescoring worker outside a Next.js request: the queue client is a stand-in,
// the signature check, the commands and the database are real.
const queue = vi.hoisted(() => ({ published: [] as unknown[] }));

vi.mock('@upstash/qstash', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Client: class {
    publishJSON(message: unknown) {
      queue.published.push(message);
      return Promise.resolve({ messageId: 'test-message' });
    }
  },
}));

const { POST } = await import('../src/app/api/v1/workers/crm/rescore/route');
const { leadRescoreRunId, runLeadRescore } = await import('../src/workers/lead-rescore');

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'rescore-route-test-current-signing-key';
const ROUTE_URL = 'http://localhost:3000/api/v1/workers/crm/rescore';
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'rescore-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'rescore-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  queue.published.length = 0;
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the route and the body's hash. */
function sign(body: string, key = CURRENT_KEY): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: ROUTE_URL,
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: newId(),
      body: createHash('sha256').update(body).digest('base64url'),
    }),
  );
  const signature = createHmac('sha256', key).update(`${header}.${claims}`).digest('base64url');
  return `${header}.${claims}.${signature}`;
}

function call(body: string, signature?: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== undefined) headers.set('upstash-signature', signature);
  return POST(new Request(ROUTE_URL, { method: 'POST', headers, body }));
}

describe('POST /api/v1/workers/crm/rescore', () => {
  it.each([
    ['no signature', () => undefined],
    ['a signature made with another key', (body: string) => sign(body, 'some-other-signing-key')],
    ['a signature of another body', () => sign('{"entityId":2}')],
  ])('refuses a call with %s', async (_label, signatureFor) => {
    const body = '{}';
    const response = await call(body, signatureFor(body));
    expect(response.status).toBe(401);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe('unauthorized');
  });

  it('answers 503 and does nothing where the queue is not configured', async () => {
    Reflect.deleteProperty(process.env, 'QSTASH_TOKEN');
    const response = await call('{}', sign('{}'));
    expect(response.status).toBe(503);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe('integration_unavailable');
  });

  it.each([
    ['a lead without its company', () => ({ afterId: newId() })],
    ['a night that is not a date', () => ({ runDate: 'yesterday' })],
  ])('refuses for good a body that names %s', async (_label, bodyFor) => {
    const body = JSON.stringify(bodyFor());
    const response = await call(body, sign(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
  });

  it('rescores every live company in turn for a signed call, and is done', async () => {
    const response = await call('{}', sign('{}'));
    expect(response.status).toBe(200);
    const result = LeadRescoreWorkerResponse.parse(await response.json());
    expect(result.done).toBe(true);
    // At least one batch for each of the four companies.
    expect(result.batches).toBeGreaterThanOrEqual(4);
    expect(queue.published).toEqual([]);
  }, 120_000);
});

describe('the rescoring run', () => {
  it('hands the rest to a fresh call when its time is spent, once for each place it stopped', async () => {
    const night = Date.parse('2031-03-04T21:30:00Z');
    const result = await runLeadRescore({ entityId: 2 }, { budgetMs: 0, now: () => night });
    expect(result).toEqual({ batches: 0, rescored: 0, done: false });
    expect(queue.published).toEqual([
      expect.objectContaining({
        url: ROUTE_URL,
        body: { runDate: '2031-03-04', entityId: 2 },
        deduplicationId: 'lead-rescore-2031-03-04-2-start',
      }),
    ]);
    const after = newId();
    expect(leadRescoreRunId({ runDate: '2031-03-04', entityId: 3, afterId: after })).toBe(
      `lead-rescore-2031-03-04-3-${after}`,
    );
  });

  it('carries the night of its first call through every hand-over, so a later night never repeats an id (M1)', async () => {
    // A hand-over received after midnight keeps the night its run started on.
    const afterMidnight = Date.parse('2031-03-05T00:10:00Z');
    await runLeadRescore(
      { runDate: '2031-03-04', entityId: 2 },
      { budgetMs: 0, now: () => afterMidnight },
    );
    // The next night stops at the same place, and its hand-over is not taken for a repeat.
    const nextNight = Date.parse('2031-03-05T21:30:00Z');
    await runLeadRescore({ entityId: 2 }, { budgetMs: 0, now: () => nextNight });
    const sent = (queue.published as { deduplicationId: string; body: unknown }[]).map((m) => [
      m.deduplicationId,
      m.body,
    ]);
    expect(sent).toEqual([
      ['lead-rescore-2031-03-04-2-start', { runDate: '2031-03-04', entityId: 2 }],
      ['lead-rescore-2031-03-05-2-start', { runDate: '2031-03-05', entityId: 2 }],
    ]);
  });

  it('stops at the first number no company has', async () => {
    const result = await runLeadRescore({ entityId: 99 }, {});
    expect(result).toEqual({ batches: 0, rescored: 0, done: true });
  });
});
