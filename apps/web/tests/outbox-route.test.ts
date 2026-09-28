import { ErrorEnvelope, newId, OutboxPublishResponse } from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { asMigrator, asOutboxPublisher, closeDb } from '@shakti/db/testing';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../src/app/api/v1/workers/outbox/publish/route';

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'outbox-route-test-current-signing-key';
const NEXT_KEY = 'outbox-route-test-next-signing-key';
const ROUTE_URL = 'http://localhost:3000/api/v1/workers/outbox/publish';
const QSTASH_ENV = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'outbox-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = NEXT_KEY;
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});
afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the route and the body's hash. */
function sign(body: string, options: { key?: string; url?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: options.url ?? ROUTE_URL,
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: newId(),
      body: createHash('sha256').update(body).digest('base64url'),
    }),
  );
  const signature = createHmac('sha256', options.key ?? CURRENT_KEY)
    .update(`${header}.${claims}`)
    .digest('base64url');
  return `${header}.${claims}.${signature}`;
}

function call(body: string, signature?: string, requestId?: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== undefined) headers.set('upstash-signature', signature);
  if (requestId !== undefined) headers.set('x-request-id', requestId);
  return POST(new Request(ROUTE_URL, { method: 'POST', headers, body }));
}

async function pendingRow(): Promise<string> {
  const id = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json)
             values (${id}, 1, 'admin.user.reactivated', 'user', ${newId()}, '{"v": 1}'::jsonb)`,
  );
  return id;
}

async function publishedAt(id: string): Promise<Date | null> {
  const [row] = await asOutboxPublisher(
    (p) =>
      p<{ published_at: Date | null }[]>`select published_at from outbox_events where id = ${id}`,
  );
  return row?.published_at ?? null;
}

describe('POST /api/v1/workers/outbox/publish', () => {
  it('answers 503 and does nothing where the queue is not configured', async () => {
    Reflect.deleteProperty(process.env, 'QSTASH_TOKEN');
    const id = await pendingRow();
    const response = await call('{}', sign('{}'));
    expect(response.status).toBe(503);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe('integration_unavailable');
    expect(await publishedAt(id)).toBeNull();
  });

  it.each([
    ['no signature', undefined],
    ['a signature made with another key', sign('{}', { key: 'some-other-signing-key' })],
    ['a signature of another body', sign('{"run": true}')],
    ['a signature for another address', sign('{}', { url: 'https://example.com/other' })],
    ['something that is not a signature', 'not-a-token'],
  ])('refuses a call with %s', async (_label, signature) => {
    const id = await pendingRow();
    const response = await call('{}', signature);
    expect(response.status).toBe(401);
    expect(ErrorEnvelope.parse(await response.json()).error).toMatchObject({
      code: 'unauthorized',
      message: 'Please sign in to continue.',
    });
    expect(await publishedAt(id)).toBeNull();
  });

  it.each([
    ['the current key', CURRENT_KEY],
    ['the next key, during a rotation', NEXT_KEY],
  ])('runs the publisher for a call signed with %s', async (_label, key) => {
    const id = await pendingRow();
    const response = await call('{}', sign('{}', { key }));
    expect(response.status).toBe(200);
    const counts = OutboxPublishResponse.parse(await response.json());
    expect(counts.claimed).toBeGreaterThanOrEqual(1);
    expect(counts.skipped).toBeGreaterThanOrEqual(1);
    // Nobody listens to this event yet: delivered without being sent.
    expect(await publishedAt(id)).toEqual(expect.any(Date));
  });

  it("answers with the caller's well-formed request id, and a new one for any other", async () => {
    const given = `outbox-route-${newId()}`;
    const kept = await call('{}', sign('{}'), given);
    expect(kept.status).toBe(200);
    expect(kept.headers.get('x-request-id')).toBe(given);

    const refused = await call('{}', undefined, given);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('x-request-id')).toBe(given);
    expect(ErrorEnvelope.parse(await refused.json()).error.requestId).toBe(given);

    const replaced = await call('{}', sign('{}'), 'not safe to echo');
    expect(replaced.headers.get('x-request-id')).not.toBe('not safe to echo');
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("answers with the platform's request id over the caller's, as every route and action does", async () => {
    const platform = `bom1::route-${newId()}`;
    const response = await POST(
      new Request(ROUTE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'upstash-signature': sign('{}'),
          'x-vercel-id': platform,
          'x-request-id': 'chosen-by-caller',
        },
        body: '{}',
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe(platform);
  });

  it('refuses a body larger than a worker call carries, reading none of a declared one, and runs nothing', async () => {
    const id = await pendingRow();
    const declared = new Request(ROUTE_URL, {
      method: 'POST',
      headers: { 'upstash-signature': sign('{}'), 'content-length': '1048576' },
      body: '{}',
    });
    const refused = await POST(declared);
    expect(refused.status).toBe(400);
    expect(refused.headers.get('upstash-nonretryable-error')).toBe('true');
    expect(ErrorEnvelope.parse(await refused.json()).error.code).toBe('validation_failed');
    expect(declared.bodyUsed).toBe(false);

    // Sent without a length, it is read only as far as the cap.
    const big = JSON.stringify({ pad: 'x'.repeat(8 * 1024) });
    const streamed = await POST(
      new Request(ROUTE_URL, {
        method: 'POST',
        headers: { 'upstash-signature': sign(big) },
        body: new Blob([big]).stream(),
        duplex: 'half',
      } as RequestInit),
    );
    expect(streamed.status).toBe(400);
    expect(await publishedAt(id)).toBeNull();
  });
});
