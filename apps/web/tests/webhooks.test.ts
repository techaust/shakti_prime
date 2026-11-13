import { newId, type WebhookProvider } from '@shakti/contracts';
import { closeWebhookDb } from '@shakti/db/webhooks';
import { asMigrator, closeDb } from '@shakti/db/testing';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as GOOGLE } from '../src/app/api/v1/webhooks/google/leadform/route';
import { POST as EXOTEL_STATUS } from '../src/app/api/v1/webhooks/exotel/call-status/route';
import {
  GET as EXOTEL_INCOMING_GET,
  POST as EXOTEL_INCOMING,
} from '../src/app/api/v1/webhooks/exotel/incoming/[secret]/route';
import { POST as LIVEKIT } from '../src/app/api/v1/webhooks/livekit/route';
import { GET as LEADGEN_GET, POST as LEADGEN } from '../src/app/api/v1/webhooks/meta/leadgen/route';
import {
  GET as WHATSAPP_GET,
  POST as WHATSAPP,
} from '../src/app/api/v1/webhooks/meta/whatsapp/route';
import type { RouteContext } from '../src/webhooks/receive';
import {
  everyProvider,
  TEST_ORIGIN,
  TEST_WEBHOOK_ENV,
  type SignedDelivery,
} from '../src/webhooks/signed-deliveries';
import { POST as FAILED } from '../src/app/api/v1/workers/webhooks/failed/route';
import { POST as PROCESS } from '../src/app/api/v1/workers/webhooks/process/route';
import { processAgain } from '../src/webhooks/replay';
import { processWebhook } from '../src/workers/webhooks/process';
import { runWebhookSweep } from '../src/workers/webhooks/sweep';
import { createTestPrincipal } from '@shakti/db/testing';

// The webhook routes on real Postgres (docs/03-roadmap-appendix/phase2.md §5.1): stored through
// `webhook_receiver`, and, with no queue configured (as locally and in CI), processed in this
// process after the answer as `system:workers`.

const ROUTES: Record<WebhookProvider, (r: Request, c?: RouteContext) => Promise<Response>> = {
  meta_whatsapp: WHATSAPP,
  meta_leadgen: LEADGEN,
  google_leadform: GOOGLE,
  exotel_status: EXOTEL_STATUS,
  exotel_incoming: EXOTEL_INCOMING_GET,
  livekit: LIVEKIT,
};

const QUEUE = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'] as const;
const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const name of [...QUEUE, ...Object.keys(TEST_WEBHOOK_ENV)])
    saved.set(name, process.env[name]);
  for (const name of QUEUE) Reflect.deleteProperty(process.env, name);
  Object.assign(process.env, TEST_WEBHOOK_ENV);
});

afterAll(async () => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  await closeWebhookDb();
  await closeDb();
});

interface Row {
  id: string;
  provider: string;
  provider_event_id: string;
  attempts: number;
  processed: boolean;
  failed: boolean;
  error_code: string | null;
}

/** The newest row now: rows stored after it are a test's own (ids are UUIDv7, in time order). */
async function newest(): Promise<string> {
  const [row] = await asMigrator(
    (m) => m<{ id: string | null }[]>`select max(id::text) as id from webhook_inbox`,
  );
  return row?.id ?? '00000000-0000-0000-0000-000000000000';
}

async function rowsAfter(mark: string): Promise<Row[]> {
  return asMigrator(
    (m) => m<Row[]>`
      select id, provider, provider_event_id, attempts, processed_at is not null as processed,
             failed_at is not null as failed, error_code
        from webhook_inbox where id::text > ${mark} order by id`,
  );
}

/** Waits for the in-process work after an answer, up to five seconds. */
async function settled(id: string): Promise<Row> {
  for (let i = 0; i < 50; i += 1) {
    const [row] = await asMigrator(
      (m) => m<Row[]>`
        select id, provider, provider_event_id, attempts, processed_at is not null as processed,
               failed_at is not null as failed, error_code
          from webhook_inbox where id = ${id}`,
    );
    if (row !== undefined && (row.processed || row.failed)) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`row ${id} was not processed`);
}

function send(d: SignedDelivery, tampered = false): Promise<Response> {
  const params = tampered ? (d.tamperedParams ?? d.params) : d.params;
  return ROUTES[d.provider](tampered ? d.tampered() : d.request(), {
    params: Promise.resolve(params),
  });
}

describe('the webhook routes on real Postgres', () => {
  it('store each provider’s delivery once and process it once, though delivered twice', async () => {
    for (const d of await everyProvider()) {
      const mark = await newest();
      const first = await send(d);
      const second = await send(d);
      expect({ provider: d.provider, statuses: [first.status, second.status] }).toEqual({
        provider: d.provider,
        statuses: [200, 200],
      });
      const rows = (await rowsAfter(mark)).filter((r) => r.provider === d.provider);
      expect(rows, d.provider).toHaveLength(1);
      const row = await settled(rows[0]?.id ?? '');
      // No slice has registered a handler yet, so the row is processed with its code.
      expect(row).toMatchObject({ processed: true, attempts: 1, error_code: 'no_handler' });
      // Processing it again changes nothing.
      expect(await processWebhook(row.id, { requestId: newId() })).toEqual({
        inboxId: row.id,
        outcome: 'duplicate',
      });
    }
  });

  it('store nothing for a delivery with a changed byte', async () => {
    for (const d of await everyProvider()) {
      const mark = await newest();
      const answer = await send(d, true);
      expect({ provider: d.provider, status: answer.status }).toEqual({
        provider: d.provider,
        status: 401,
      });
      expect((await rowsAfter(mark)).filter((r) => r.provider === d.provider)).toEqual([]);
    }
  });

  it('fail a payload its contract refuses with payload_unreadable, visibly, and never try it again', async () => {
    // Signed with the right secret, but not a WhatsApp webhook.
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [], run: newId() });
    const signature = `sha256=${createHmac('sha256', TEST_WEBHOOK_ENV.WHATSAPP_APP_SECRET).update(body).digest('hex')}`;
    const mark = await newest();
    const answer = await WHATSAPP(
      new Request(`${TEST_ORIGIN}/api/v1/webhooks/meta/whatsapp`, {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': signature, 'content-type': 'application/json' },
      }),
    );
    expect(answer.status).toBe(200);
    const [stored] = (await rowsAfter(mark)).filter((r) => r.provider === 'meta_whatsapp');
    const row = await settled(stored?.id ?? '');
    expect(row).toMatchObject({
      failed: true,
      processed: false,
      error_code: 'payload_unreadable',
      attempts: 1,
    });
    expect(await processWebhook(row.id, { requestId: newId() })).toEqual({
      inboxId: row.id,
      outcome: 'duplicate',
    });
    expect((await settled(row.id)).attempts).toBe(1);
  });

  it('take Exotel’s inbound applet by POST as well, under the same key', async () => {
    const unique = newId();
    const mark = await newest();
    const form = new URLSearchParams({
      CallSid: unique,
      CallFrom: '09000000023',
      CallTo: '08000000160',
      Direction: 'incoming',
    }).toString();
    const at = `${TEST_ORIGIN}/api/v1/webhooks/exotel/incoming/${TEST_WEBHOOK_ENV.EXOTEL_INCOMING_SECRET}`;
    const answer = await EXOTEL_INCOMING(
      new Request(at, {
        method: 'POST',
        body: form,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
      { params: Promise.resolve({ secret: TEST_WEBHOOK_ENV.EXOTEL_INCOMING_SECRET }) },
    );
    expect(answer.status).toBe(200);
    const rows = (await rowsAfter(mark)).filter((r) => r.provider === 'exotel_incoming');
    expect(rows.map((r) => r.provider_event_id)).toEqual([unique]);
  });

  it('answer Meta’s subscription check on both Meta routes', async () => {
    const check = (path: string, token: string) =>
      new Request(
        `${TEST_ORIGIN}${path}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=42`,
      );
    const whatsapp = WHATSAPP_GET(
      check('/api/v1/webhooks/meta/whatsapp', TEST_WEBHOOK_ENV.WHATSAPP_VERIFY_TOKEN),
    );
    expect(await whatsapp.text()).toBe('42');
    const leadgen = LEADGEN_GET(
      check('/api/v1/webhooks/meta/leadgen', TEST_WEBHOOK_ENV.META_LEADGEN_VERIFY_TOKEN),
    );
    expect(await leadgen.text()).toBe('42');
    // Each route answers only its own phrase.
    expect(
      LEADGEN_GET(check('/api/v1/webhooks/meta/leadgen', TEST_WEBHOOK_ENV.WHATSAPP_VERIFY_TOKEN))
        .status,
    ).toBe(403);
  });
});

// --- The worker, its failure callback, the sweep and Process again -----------------------------

const SIGNING_KEY = 'webhook-worker-test-current-signing-key';
const QUEUE_ENV = {
  QSTASH_TOKEN: 'webhook-worker-test-token',
  QSTASH_CURRENT_SIGNING_KEY: SIGNING_KEY,
  QSTASH_NEXT_SIGNING_KEY: 'webhook-worker-test-next-signing-key',
  BETTER_AUTH_URL: TEST_ORIGIN,
};
const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the address and the body's hash. */
function qstashSignature(body: string, address: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(
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
  const signature = createHmac('sha256', SIGNING_KEY)
    .update(`${header}.${claims}`)
    .digest('base64url');
  return `${header}.${claims}.${signature}`;
}

function signedCall(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: string,
  signed = true,
): Promise<Response> {
  const address = `${TEST_ORIGIN}${path}`;
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signed) headers.set('upstash-signature', qstashSignature(body, address));
  return handler(new Request(address, { method: 'POST', headers, body }));
}

/** A stored delivery that waits, written as the table owner. */
async function waitingRow(
  provider = 'livekit',
  payload: unknown = { id: `EV_${newId()}`, event: 'room_started', createdAt: '1790500900' },
): Promise<string> {
  const id = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into webhook_inbox (id, provider, provider_event_id, payload_json, payload_sha256)
             values (${id}, ${provider}, ${id}, ${JSON.stringify(payload)}::text::jsonb,
                     ${createHash('sha256').update(id).digest('hex')})`,
  );
  return id;
}

async function rowOf(id: string): Promise<Row> {
  const [row] = await asMigrator(
    (m) => m<Row[]>`
      select id, provider, provider_event_id, attempts, processed_at is not null as processed,
             failed_at is not null as failed, error_code
        from webhook_inbox where id = ${id}`,
  );
  if (row === undefined) throw new Error(`no row ${id}`);
  return row;
}

describe('the webhook worker and its failure callback', () => {
  const kept = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const name of Object.keys(QUEUE_ENV)) kept.set(name, process.env[name]);
    Object.assign(process.env, QUEUE_ENV);
  });
  afterEach(() => {
    for (const [name, value] of kept) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  });

  it('processes a stored row once for a signed job, and answers a repeat as a duplicate', async () => {
    const id = await waitingRow();
    const body = JSON.stringify({ inboxId: id });
    const first = await signedCall(PROCESS, '/api/v1/workers/webhooks/process', body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ inboxId: id, outcome: 'processed', handled: false });
    const again = await signedCall(PROCESS, '/api/v1/workers/webhooks/process', body);
    expect(await again.json()).toEqual({ inboxId: id, outcome: 'duplicate' });
    expect(await rowOf(id)).toMatchObject({
      processed: true,
      attempts: 1,
      error_code: 'no_handler',
    });
  });

  it('refuses an unsigned job, a body over 4 KiB and a body that is not a job', async () => {
    const id = await waitingRow();
    const body = JSON.stringify({ inboxId: id });
    expect(
      (await signedCall(PROCESS, '/api/v1/workers/webhooks/process', body, false)).status,
    ).toBe(401);
    const big = JSON.stringify({ inboxId: id, padding: 'p'.repeat(5000) });
    const tooLarge = await signedCall(PROCESS, '/api/v1/workers/webhooks/process', big);
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.headers.get('upstash-nonretryable-error')).toBe('true');
    expect((await signedCall(PROCESS, '/api/v1/workers/webhooks/process', '{"id":1}')).status).toBe(
      400,
    );
    expect(await rowOf(id)).toMatchObject({ processed: false, attempts: 0 });
  });

  it('fails a row QStash gave up on with handler_failed, once', async () => {
    const id = await waitingRow();
    const callback = JSON.stringify({
      status: 500,
      sourceBody: Buffer.from(JSON.stringify({ inboxId: id })).toString('base64'),
      retried: 3,
      maxRetries: 3,
    });
    const first = await signedCall(FAILED, '/api/v1/workers/webhooks/failed', callback);
    expect(await first.json()).toEqual({ inboxId: id, outcome: 'failed' });
    const again = await signedCall(FAILED, '/api/v1/workers/webhooks/failed', callback);
    expect(await again.json()).toEqual({ inboxId: id, outcome: 'unchanged' });
    expect(await rowOf(id)).toMatchObject({ failed: true, error_code: 'handler_failed' });
    expect(
      (await signedCall(FAILED, '/api/v1/workers/webhooks/failed', callback, false)).status,
    ).toBe(401);
  });

  it('the sweep publishes a row left waiting once per attempt it is on', async () => {
    const id = await waitingRow();
    await asMigrator(
      (m) =>
        m`update webhook_inbox set claimed_until = now() - interval '5 minutes' where id = ${id}`,
    );
    // The row arrived just now; the sweep takes rows idle a minute, so it is aged as the owner.
    await asMigrator((m) => m`alter table webhook_inbox disable trigger webhook_inbox_guard`);
    try {
      await asMigrator(
        (m) =>
          m`update webhook_inbox set received_at = now() - interval '5 minutes' where id = ${id}`,
      );
    } finally {
      await asMigrator((m) => m`alter table webhook_inbox enable trigger webhook_inbox_guard`);
    }
    const published: { inboxId: string; deduplicationId: string }[] = [];
    const result = await runWebhookSweep({
      requestId: newId(),
      publish: (_config, inboxId, deduplicationId) => {
        published.push({ inboxId, deduplicationId });
        return Promise.resolve();
      },
    });
    expect(published).toContainEqual({ inboxId: id, deduplicationId: `${id}:s0` });
    expect(result.republished).toBe(published.length);
  });
});

describe('Process again', () => {
  it('processes a failed row once more, once', async () => {
    const executive = await createTestPrincipal('executive');
    // A WhatsApp row its contract refuses: failed for good with payload_unreadable.
    const id = await waitingRow('meta_whatsapp', {
      object: 'whatsapp_business_account',
      entry: [],
    });
    expect(await processWebhook(id, { requestId: newId() })).toMatchObject({ outcome: 'failed' });
    const processed: string[] = [];
    const replayed = await processAgain(
      executive,
      newId(),
      { inboxId: id },
      {},
      {
        qstash: () => undefined,
        later: (task) => {
          void task();
        },
        process: async (inboxId, options) => {
          processed.push(inboxId);
          return processWebhook(inboxId, options);
        },
      },
    );
    expect(replayed).toEqual({ inboxId: id, provider: 'meta_whatsapp', attempts: 1 });
    expect(processed).toEqual([id]);
    // The same bytes fail the same way, and stay failed until Process again once more.
    expect(await settled(id)).toMatchObject({ failed: true, attempts: 2 });
    await expect(
      processAgain(executive, newId(), { inboxId: newId() }, {}, { qstash: () => undefined }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('publishes it under an id of its own for the attempt it is on, with a queue', async () => {
    const executive = await createTestPrincipal('executive');
    const id = await waitingRow('meta_whatsapp', {
      object: 'whatsapp_business_account',
      entry: [],
    });
    await processWebhook(id, { requestId: newId() });
    const published: string[] = [];
    await processAgain(
      executive,
      newId(),
      { inboxId: id },
      {},
      {
        qstash: () => ({
          token: 'webhook-replay-test-token',
          currentSigningKey: SIGNING_KEY,
          nextSigningKey: 'webhook-replay-test-next',
          baseUrl: undefined,
          publishUrl: `${TEST_ORIGIN}/api/v1/workers/outbox/publish`,
        }),
        publish: (_config, _inboxId, deduplicationId) => {
          published.push(deduplicationId);
          return Promise.resolve();
        },
      },
    );
    expect(published).toEqual([`${id}:r1`]);
  });
});
