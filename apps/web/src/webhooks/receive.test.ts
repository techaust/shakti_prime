import { newId, type WebhookProvider } from '@shakti/contracts';
import { memoryKeyValue } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import type { QStashConfig } from '../workers/qstash';
import { WEBHOOK_BODY_MAX_BYTES, WEBHOOK_VERIFIERS, type WebhookEnv } from './providers';
import { metaHandshake, receiveWebhook, type WebhookDeps } from './receive';
import { refusedKey, refusedLastDay } from './refusals';
import {
  everyProvider,
  googleDelivery,
  TEST_ORIGIN,
  TEST_WEBHOOK_ENV,
  whatsappDelivery,
  type SignedDelivery,
} from './signed-deliveries';

// The webhook routes' helper on stand-in stores (docs/03-roadmap-appendix/phase2.md §5.1); the same
// routes on real Postgres are in apps/web/tests/webhooks.test.ts.

const NOW = new Date();
const QUEUE: QStashConfig = {
  token: 'queue key for the webhook tests',
  currentSigningKey: 'signing key one for the webhook tests',
  nextSigningKey: 'signing key two for the webhook tests',
  baseUrl: undefined,
  publishUrl: `${TEST_ORIGIN}/api/v1/workers/outbox/publish`,
};

interface Harness {
  deps: Partial<WebhookDeps>;
  rows: Map<
    string,
    { id: string; provider: string; eventId: string; payload: unknown; sha256: string }
  >;
  published: { inboxId: string; deduplicationId: string }[];
  processed: string[];
  keyValue: ReturnType<typeof memoryKeyValue>;
}

function harness(over: Partial<WebhookDeps> = {}, queue: QStashConfig | null = QUEUE): Harness {
  const rows: Harness['rows'] = new Map();
  const published: Harness['published'] = [];
  const processed: string[] = [];
  const keyValue = memoryKeyValue();
  const deps: Partial<WebhookDeps> = {
    env: { ...TEST_WEBHOOK_ENV },
    now: () => NOW,
    receiverConfigured: () => true,
    keyValue: () => keyValue,
    store: (provider, eventId, payload, sha256) => {
      const key = `${provider}:${eventId}`;
      const found = rows.get(key);
      if (found !== undefined) return Promise.resolve({ inboxId: found.id, repeated: true });
      const id = newId();
      rows.set(key, { id, provider, eventId, payload, sha256 });
      return Promise.resolve({ inboxId: id, repeated: false });
    },
    qstash: () => queue ?? undefined,
    publish: (_config, inboxId, deduplicationId) => {
      published.push({ inboxId, deduplicationId });
      return Promise.resolve();
    },
    later: (task) => {
      void task();
    },
    process: (inboxId) => {
      processed.push(inboxId);
      return Promise.resolve({ inboxId, outcome: 'processed', handled: false });
    },
    ...over,
  };
  return { deps, rows, published, processed, keyValue };
}

function route(provider: WebhookProvider, h: Harness) {
  return receiveWebhook(provider, WEBHOOK_VERIFIERS[provider] as never, {
    deps: h.deps,
    ...(provider === 'exotel_incoming' ? { source: 'query' as const } : {}),
  });
}

function call(d: SignedDelivery, h: Harness, tampered = false) {
  return route(d.provider, h)(tampered ? d.tampered() : d.request(), {
    params: Promise.resolve(tampered ? (d.tamperedParams ?? d.params) : d.params),
  });
}

describe('receiveWebhook', () => {
  it('stores every provider’s signed delivery once and publishes it under its row id, within 2 seconds', async () => {
    for (const d of await everyProvider(NOW)) {
      const h = harness();
      const started = performance.now();
      const answer = await call(d, h);
      expect(performance.now() - started, d.provider).toBeLessThan(2_000);
      expect({ provider: d.provider, status: answer.status }).toEqual({
        provider: d.provider,
        status: 200,
      });
      expect(await answer.json()).toEqual({ received: true });
      expect(answer.headers.get('cache-control')).toBe('no-store');
      const [row] = [...h.rows.values()];
      expect(h.rows.size, d.provider).toBe(1);
      expect(h.published).toEqual([{ inboxId: row?.id, deduplicationId: row?.id }]);
      expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
      // A repeat is the same row, answered alike and published no more.
      const again = await call(d, h);
      expect(again.status).toBe(200);
      expect(h.rows.size).toBe(1);
      expect(h.published).toHaveLength(1);
    }
  });

  it('keys each provider on its own event id, and WhatsApp’s batches on the body', async () => {
    const h = harness();
    for (const d of await everyProvider(NOW)) await call(d, h);
    const ids = Object.fromEntries([...h.rows.values()].map((r) => [r.provider, r.eventId]));
    expect(ids.meta_whatsapp).toMatch(/^[0-9a-f]{64}$/);
    expect(ids.meta_whatsapp).toBe(
      [...h.rows.values()].find((r) => r.provider === 'meta_whatsapp')?.sha256,
    );
    expect(ids.meta_leadgen).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.google_leadform).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.exotel_status).toMatch(/^[0-9a-f-]{36}:completed$/);
    expect(ids.exotel_incoming).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.livekit).toMatch(/^EV_/);
  });

  it('keeps the signed call reference beside Exotel’s fields, over any the body names', async () => {
    const h = harness();
    const [, , , status] = await everyProvider(NOW);
    if (status === undefined) throw new Error('expected the Exotel status delivery');
    await call(status, h);
    const [row] = [...h.rows.values()];
    const payload = row?.payload as Record<string, unknown>;
    expect(payload.bos_ref).toBe(payload.CallSid);
    expect(payload.Status).toBe('completed');
  });

  it('refuses a changed byte with 401, stores nothing and counts it for the hour', async () => {
    for (const d of await everyProvider(NOW)) {
      const h = harness();
      const answer = await call(d, h, true);
      expect({ provider: d.provider, status: answer.status }).toEqual({
        provider: d.provider,
        status: 401,
      });
      const body = (await answer.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('unauthorized');
      expect(h.rows.size).toBe(0);
      expect(h.published).toEqual([]);
      expect(await h.keyValue.get(refusedKey(d.provider, NOW))).toBe('1');
      expect(await refusedLastDay(h.keyValue, d.provider, NOW)).toBe(1);
    }
  });

  it('still refuses when the count cannot be kept', async () => {
    const h = harness({
      keyValue: () => {
        throw new Error('store down');
      },
    });
    const answer = await call(googleDelivery(newId(), 'a key that is not ours'), h);
    expect(answer.status).toBe(401);
  });

  it('answers integration_unavailable before reading anything while the secret or the connection is unset', async () => {
    const d = whatsappDelivery();
    const noSecret = harness({ env: { ...TEST_WEBHOOK_ENV, WHATSAPP_APP_SECRET: '' } });
    const answer = await call(d, noSecret);
    expect(answer.status).toBe(503);
    expect(((await answer.json()) as { error: { code: string } }).error.code).toBe(
      'integration_unavailable',
    );
    expect(noSecret.rows.size).toBe(0);
    const noReceiver = harness({ receiverConfigured: () => false });
    expect((await call(d, noReceiver)).status).toBe(503);
  });

  it('refuses a body over the cap with 400 before checking it', async () => {
    const h = harness();
    const big = JSON.stringify({ lead_id: 'x', padding: 'p'.repeat(WEBHOOK_BODY_MAX_BYTES) });
    const answer = await route(
      'google_leadform',
      h,
    )(new Request(`${TEST_ORIGIN}/api/v1/webhooks/google/leadform`, { method: 'POST', body: big }));
    expect(answer.status).toBe(400);
    expect(await h.keyValue.get(refusedKey('google_leadform', NOW))).toBeNull();
  });

  it('answers 503 when the delivery cannot be stored, so the provider sends it again', async () => {
    const h = harness({ store: () => Promise.reject(new Error('statement timeout')) });
    const answer = await call(whatsappDelivery(), h);
    expect(answer.status).toBe(503);
    expect(h.published).toEqual([]);
  });

  it('answers 200 when the publish fails: the sweep publishes the row later', async () => {
    const h = harness({ publish: () => Promise.reject(new Error('no answer within 800 ms')) });
    const answer = await call(whatsappDelivery(), h);
    expect(answer.status).toBe(200);
    expect(h.rows.size).toBe(1);
  });

  it('without a queue processes the new row in this process after the answer', async () => {
    const h = harness({}, null);
    const d = whatsappDelivery();
    await call(d, h);
    await call(d, h);
    expect(h.published).toEqual([]);
    expect(h.processed).toEqual([[...h.rows.values()][0]?.id]);
  });

  it('drops NUL characters, which Postgres keeps in no JSON text', async () => {
    const h = harness();
    const d = whatsappDelivery(newId(), {
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'other', value: { note: 'a\u0000b' } }] }],
    });
    await call(d, h);
    expect(JSON.stringify([...h.rows.values()][0]?.payload)).not.toContain('\\u0000');
  });
});

describe('the Meta subscription check', () => {
  const handshake = (env: WebhookEnv) =>
    metaHandshake('meta_whatsapp', WEBHOOK_VERIFIERS.meta_whatsapp, {
      env,
      receiverConfigured: () => true,
    });
  const at = (token: string) =>
    new Request(
      `${TEST_ORIGIN}/api/v1/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=1158201444`,
    );

  it('answers the challenge as text for the verify phrase', async () => {
    const answer = handshake({ ...TEST_WEBHOOK_ENV })(at(TEST_WEBHOOK_ENV.WHATSAPP_VERIFY_TOKEN));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toContain('text/plain');
    expect(await answer.text()).toBe('1158201444');
  });

  it('answers forbidden for another phrase, and unavailable while unset', () => {
    expect(handshake({ ...TEST_WEBHOOK_ENV })(at('a guess')).status).toBe(403);
    expect(handshake({})(at('anything')).status).toBe(503);
  });
});
