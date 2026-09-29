import {
  DomainError,
  ErrorEnvelope,
  newId,
  OutboxEventResult,
  type DeliveredEvent,
} from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { asMigrator, asOutboxPublisher, closeDb } from '@shakti/db/testing';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../src/app/api/v1/workers/outbox/[type]/route';
import { defaultAuthDeps } from '../src/auth/deps';
import { EVENT_HANDLERS, type EventHandler } from '../src/workers/events/registry';
import { readDeliveryCheck } from '../src/workers/events/probe';
import { publishOutbox } from '../src/workers/outbox';
import { memoryAlertSink } from '../src/observability/alerts';

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'event-route-test-current-signing-key';
const APP = 'http://localhost:3000';
const TYPE = 'platform.probe.requested';
const url = (type: string) => `${APP}/api/v1/workers/outbox/${type}`;
const QSTASH_ENV = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'BETTER_AUTH_URL',
] as const;
const saved = new Map<string, string | undefined>();
const registered = EVENT_HANDLERS[TYPE];
if (registered === undefined) throw new Error(`no worker for ${TYPE}`);
const probeHandler: EventHandler = registered;

beforeEach(() => {
  for (const name of QSTASH_ENV) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'event-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'event-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = APP;
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  EVENT_HANDLERS[TYPE] = probeHandler;
});
afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the address and the body's hash. */
function sign(body: string, address: string, key = CURRENT_KEY): string {
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

let sequence = 9_000_000;
function probe(overrides: Partial<DeliveredEvent> = {}): DeliveredEvent {
  sequence += 1;
  return {
    id: newId(),
    sequence: String(sequence),
    type: TYPE,
    entityId: 1,
    aggregateType: 'delivery_probe',
    aggregateId: newId(),
    payload: { v: 1, requestedAt: new Date().toISOString() },
    ...overrides,
  };
}

function call(
  type: string,
  body: string,
  options: { signature?: string | null; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json', ...options.headers });
  const signature = options.signature === undefined ? sign(body, url(type)) : options.signature;
  if (signature !== null) headers.set('upstash-signature', signature);
  return POST(new Request(url(type), { method: 'POST', headers, body }), {
    params: Promise.resolve({ type }),
  });
}

async function envelope(response: Response) {
  return ErrorEnvelope.parse(await response.json()).error;
}

describe('POST /api/v1/workers/outbox/:type (docs/design/phase1.md §5.2)', () => {
  it('delivers a signed event to its worker, which records its arrival', async () => {
    const event = probe();
    const response = await call(TYPE, JSON.stringify(event));
    expect(response.status).toBe(200);
    expect(OutboxEventResult.parse(await response.json())).toEqual({
      eventId: event.id,
      outcome: 'done',
    });
    const check = await readDeliveryCheck(defaultAuthDeps().keyValue, new Date(), {
      probeId: event.aggregateId,
      requestedAt: String(event.payload.requestedAt),
    });
    expect(check?.state).toBe('arrived');
  });

  it.each([
    ['no signature', null],
    ['a signature made with another key', 'other'],
    ['a signature for another type', 'type'],
    ['something that is not a signature', 'not-a-token'],
  ])('refuses a call with %s and runs nothing', async (_label, kind) => {
    const event = probe();
    const body = JSON.stringify(event);
    const signature =
      kind === null
        ? null
        : kind === 'other'
          ? sign(body, url(TYPE), 'some-other-signing-key')
          : kind === 'type'
            ? sign(body, url('crm.lead.created'))
            : kind;
    const response = await call(TYPE, body, { signature });
    expect(response.status).toBe(401);
    expect((await envelope(response)).code).toBe('unauthorized');
    expect(
      await readDeliveryCheck(defaultAuthDeps().keyValue, new Date(), {
        probeId: event.aggregateId,
        requestedAt: String(event.payload.requestedAt),
      }),
    ).toMatchObject({ state: 'waiting' });
  });

  it('refuses a body over 4 KiB before anything else, and tells QStash not to retry', async () => {
    const body = JSON.stringify({ ...probe(), padding: 'x'.repeat(5000) });
    const response = await call(TYPE, body);
    expect(response.status).toBe(400);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
    const declared = await call(TYPE, '{}', { headers: { 'content-length': '99999' } });
    expect(declared.status).toBe(400);
  });

  it('answers duplicate for an id it has handled, and runs the worker once', async () => {
    let runs = 0;
    EVENT_HANDLERS[TYPE] = () => {
      runs += 1;
      return Promise.resolve();
    };
    const body = JSON.stringify(probe());
    expect((await (await call(TYPE, body)).json()) as unknown).toMatchObject({ outcome: 'done' });
    expect((await (await call(TYPE, body)).json()) as unknown).toMatchObject({
      outcome: 'duplicate',
    });
    expect(runs).toBe(1);
  });

  it('answers duplicate for an event older than the newest handled for its aggregate', async () => {
    let runs = 0;
    EVENT_HANDLERS[TYPE] = () => {
      runs += 1;
      return Promise.resolve();
    };
    const aggregateId = newId();
    const older = probe({ aggregateId });
    const newer = probe({ aggregateId });
    expect((await call(TYPE, JSON.stringify(newer))).status).toBe(200);
    const late = await call(TYPE, JSON.stringify(older));
    expect(await late.json()).toEqual({ eventId: older.id, outcome: 'duplicate' });
    expect(runs).toBe(1);
  });

  it('answers not_found, not retried, for a type no worker handles', async () => {
    const event = probe({ type: 'crm.lead.created' });
    const response = await call('crm.lead.created', JSON.stringify(event));
    expect(response.status).toBe(404);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
    const unknown = await call('crm.lead.vanished', JSON.stringify(event));
    expect(unknown.status).toBe(404);
  });

  it('refuses a body that is not the event of the type its address names', async () => {
    const mismatch = probe({ type: 'crm.lead.created' });
    expect((await call(TYPE, JSON.stringify(mismatch))).status).toBe(400);
    expect((await call(TYPE, '{"id": "not an event"}')).status).toBe(400);
    expect((await call(TYPE, 'not json')).status).toBe(400);
  });

  it.each([
    ['integration_unavailable', 503, false],
    ['internal', 500, false],
    ['forbidden', 403, true],
    ['validation_failed', 400, true],
    ['conflict', 409, true],
  ] as const)(
    'answers a worker’s %s with %i, retried only when the cause may pass',
    async (code, status, final) => {
      const failing: EventHandler = () => Promise.reject(new DomainError(code, 'worker refused'));
      EVENT_HANDLERS[TYPE] = failing;
      const event = probe();
      const response = await call(TYPE, JSON.stringify(event));
      expect(response.status).toBe(status);
      expect((await envelope(response)).code).toBe(code);
      expect(response.headers.get('upstash-nonretryable-error')).toBe(final ? 'true' : null);
      // Nothing was recorded, so a redelivery runs the worker again.
      EVENT_HANDLERS[TYPE] = probeHandler;
      expect((await call(TYPE, JSON.stringify(event))).status).toBe(200);
    },
  );

  it('answers a worker that throws anything else as internal, retried', async () => {
    EVENT_HANDLERS[TYPE] = () => Promise.reject(new TypeError('broken worker'));
    const response = await call(TYPE, JSON.stringify(probe()));
    expect(response.status).toBe(500);
    expect(response.headers.get('upstash-nonretryable-error')).toBeNull();
  });

  it('answers 503 and runs nothing where the queue is not configured', async () => {
    Reflect.deleteProperty(process.env, 'QSTASH_TOKEN');
    const response = await call(TYPE, JSON.stringify(probe()));
    expect(response.status).toBe(503);
  });
});

describe('in-process delivery without a queue (local development and CI)', () => {
  it('the publisher delivers a subscribed event to its worker through the same path', async () => {
    for (const name of QSTASH_ENV) Reflect.deleteProperty(process.env, name);
    const id = newId();
    const probeId = newId();
    const requestedAt = new Date().toISOString();
    await asMigrator(
      (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                          payload_json)
               values (${id}, 1, ${TYPE}, 'delivery_probe', ${probeId},
                       ${JSON.stringify({ v: 1, requestedAt })}::text::jsonb)`,
    );
    const counts = await publishOutbox({ alerts: memoryAlertSink() });
    expect(counts.published).toBeGreaterThanOrEqual(1);
    const [row] = await asOutboxPublisher(
      (p) => p<{ published: boolean }[]>`
        select published_at is not null as published from outbox_events where id = ${id}`,
    );
    expect(row?.published).toBe(true);
    expect(
      await readDeliveryCheck(defaultAuthDeps().keyValue, new Date(), { probeId, requestedAt }),
    ).toMatchObject({ state: 'arrived' });
  });
});
