import { ErrorEnvelope, newId, QuoteExpireWorkerResponse } from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { closeDb } from '@shakti/db/testing';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../src/app/api/v1/workers/quotes/expire/route';
import { runQuoteExpiry } from '../src/workers/quote-expiry';

// The daily quote expiry worker outside a Next.js request: the signature check, the command and
// the database are real. Which quotes it expires is proved in packages/domain (quotes.test.ts).

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'quote-expiry-test-current-signing-key';
const ROUTE_URL = 'http://localhost:3000/api/v1/workers/quotes/expire';
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'quote-expiry-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'quote-expiry-test-next-signing-key';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the route and the body's hash. */
function sign(body: string, key = CURRENT_KEY, address = ROUTE_URL): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: address,
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

describe('POST /api/v1/workers/quotes/expire', () => {
  it.each([
    ['no signature', () => undefined],
    ['a signature made with another key', (body: string) => sign(body, 'some-other-signing-key')],
    ['a signature of another body', () => sign('{"entityId":2}')],
    [
      'a signature for another route',
      (body: string) =>
        sign(body, CURRENT_KEY, 'http://localhost:3000/api/v1/workers/crm/rescore'),
    ],
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

  it('refuses for good a body that is not empty', async () => {
    const body = JSON.stringify({ entityId: 2 });
    const response = await call(body, sign(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
  });

  it('runs every live company in turn for a signed call, and is done', async () => {
    const response = await call('{}', sign('{}'));
    expect(response.status).toBe(200);
    const result = QuoteExpireWorkerResponse.parse(await response.json());
    expect(result.done).toBe(true);
    // At least one batch for each of the four companies.
    expect(result.batches).toBeGreaterThanOrEqual(4);
  }, 120_000);
});

describe('the expiry run', () => {
  it('stops taking batches when its time is spent, leaving the rest to the next day', async () => {
    expect(await runQuoteExpiry({ budgetMs: 0 })).toEqual({ batches: 0, expired: 0, done: false });
  });
});
