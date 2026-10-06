import {
  ErrorEnvelope,
  IntegrationHealthResponse,
  IntegrationReplayResponse,
  newId,
  type Principal,
} from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { asMigrator, asOutboxPublisher, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { memoryKeyValue } from '@shakti/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The actions outside a Next.js request: the headers and the signed-in caller are stand-ins; the
// commands, the definer and the database are real.
const request = vi.hoisted(() => ({
  principal: undefined as Principal | undefined,
  headers: new Headers(),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(request.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));

vi.mock('../src/auth/current-principal', () => ({
  ACTIVE_ENTITY_COOKIE: 'entity',
  TWO_FACTOR_PENDING_COOKIE: 'shakti.two_factor',
  currentPrincipal: () => Promise.resolve(request.principal),
  currentSession: () => Promise.resolve(undefined),
  forgetPrincipal: () => Promise.resolve(),
}));

const { integrationHealth, runDeliveryCheck, deliveryCheck } =
  await import('../src/actions/integrations');
const { getIntegrationHealth, postIntegrationReplay } =
  await import('../src/observability/integration-routes');

/** Every row this file writes carries its own aggregate type, so other suites' rows never count. */
const TAG = `test_ih_${newId().slice(-8)}`;

afterAll(async () => {
  await asMigrator(
    (m) => m`update outbox_events set published_at = now()
              where (aggregate_type = ${TAG} or aggregate_type = 'delivery_probe')
                and published_at is null and dead_lettered_at is null`,
  );
  await closeOutboxDb();
  await closeDb();
});

let executive: Principal;
let manager: Principal;
beforeAll(async () => {
  executive = await createTestPrincipal('executive');
  manager = await createTestPrincipal('general_manager', [1]);
});
beforeEach(() => {
  request.principal = executive;
  request.headers = new Headers({ 'x-request-id': `ih-${newId()}` });
});

async function deadLetter(entityId = 1): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                        payload_json, attempts, last_error, dead_lettered_at)
             values (${id}, ${entityId}, 'admin.user.reactivated', ${TAG}, ${newId()},
                     '{"v": 1}'::jsonb, 10, 'queue_refused', now())`,
  );
  return id;
}

function route(principal: Principal | undefined) {
  return { principal: () => Promise.resolve(principal), keyValue: memoryKeyValue() };
}

describe('GET /api/v1/admin/integrations (docs/06-api.md §3.7)', () => {
  it('answers the contract for an Executive, with the dead letters by code and never a payload', async () => {
    const id = await deadLetter();
    const response = await getIntegrationHealth(
      new Request('http://localhost:3000/api/v1/admin/integrations?limit=200'),
      route(executive),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = IntegrationHealthResponse.parse(await response.json());
    expect(body.deadLetters.items.find((i) => i.eventId === id)).toMatchObject({
      errorCode: 'queue_refused',
      attempts: 10,
      entityId: 1,
    });
    expect(
      body.outbox.byType.find((t) => t.type === 'admin.user.reactivated')?.deadLettered,
    ).toBeGreaterThanOrEqual(1);
    expect(body.webhooks).toEqual([]);
    expect(body.aiSpend).toEqual({ today: '0.00', monthToDate: '0.00', byAgent: [] });
  });

  it('pages the dead letters by the cursor it answers', async () => {
    await deadLetter();
    await deadLetter();
    const first = IntegrationHealthResponse.parse(
      await (
        await getIntegrationHealth(
          new Request('http://localhost:3000/api/v1/admin/integrations?limit=1'),
          route(executive),
        )
      ).json(),
    );
    expect(first.deadLetters.items).toHaveLength(1);
    expect(first.deadLetters.nextCursor).not.toBeNull();
    const next = IntegrationHealthResponse.parse(
      await (
        await getIntegrationHealth(
          new Request(
            `http://localhost:3000/api/v1/admin/integrations?limit=1&cursor=${first.deadLetters.nextCursor ?? ''}`,
          ),
          route(executive),
        )
      ).json(),
    );
    expect(next.deadLetters.items[0]?.eventId).not.toBe(first.deadLetters.items[0]?.eventId);
  });

  it('refuses no session, a person without the permission, and a bad query', async () => {
    const url = 'http://localhost:3000/api/v1/admin/integrations';
    const none = await getIntegrationHealth(new Request(url), route(undefined));
    expect(none.status).toBe(401);
    const gm = await getIntegrationHealth(new Request(url), route(manager));
    expect(gm.status).toBe(403);
    expect(ErrorEnvelope.parse(await gm.json()).error.code).toBe('forbidden');
    const bad = await getIntegrationHealth(new Request(`${url}?limit=500`), route(executive));
    expect(bad.status).toBe(400);
    const forged = await getIntegrationHealth(new Request(`${url}?cursor=bm90`), route(executive));
    expect(forged.status).toBe(400);
  });
});

describe('POST /api/v1/admin/integrations/replay (docs/06-api.md §3.7)', () => {
  function replay(principal: Principal | undefined, body: string, type = 'application/json') {
    return postIntegrationReplay(
      new Request('http://localhost:3000/api/v1/admin/integrations/replay', {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      }),
      route(principal),
    );
  }

  it('puts a dead letter back in the queue, audited with the caller', async () => {
    const id = await deadLetter();
    const response = await replay(executive, JSON.stringify({ eventId: id }));
    expect(response.status).toBe(200);
    expect(IntegrationReplayResponse.parse(await response.json())).toEqual({
      eventId: id,
      requeued: true,
      attempts: 0,
    });
    const [row] = await asOutboxPublisher(
      (p) => p<{ dead: boolean }[]>`
        select dead_lettered_at is not null as dead from outbox_events where id = ${id}`,
    );
    expect(row?.dead).toBe(false);
    const audit = await asMigrator(
      (m) => m<{ actor: string }[]>`
        select actor_principal_id::text as actor from audit_logs
         where command = 'integrations.dlq.replay' and aggregate_id = ${id}`,
    );
    expect(audit).toEqual([{ actor: executive.id }]);
  });

  it('refuses no session, the wrong person, a body that is not JSON and an event not held back', async () => {
    const id = await deadLetter();
    expect((await replay(undefined, JSON.stringify({ eventId: id }))).status).toBe(401);
    expect((await replay(manager, JSON.stringify({ eventId: id }))).status).toBe(403);
    expect((await replay(executive, `eventId=${id}`, 'text/plain')).status).toBe(400);
    expect((await replay(executive, '{"eventId": "nope"}')).status).toBe(400);
    expect((await replay(executive, JSON.stringify({ eventId: id }))).status).toBe(200);
    const again = await replay(executive, JSON.stringify({ eventId: id }));
    expect(again.status).toBe(409);
    expect(ErrorEnvelope.parse(await again.json()).error.details).toEqual({
      reason: 'not_dead_lettered',
    });
  });
});

describe('the Integration Health actions', () => {
  it('reads the page for an Executive and refuses a manager', async () => {
    const result = await integrationHealth({ limit: 10 });
    expect(result.ok).toBe(true);
    request.principal = manager;
    expect(await integrationHealth({ limit: 10 })).toEqual({ ok: false, error: 'forbidden' });
  });

  it('runs the delivery check, which arrives in this process where no queue is configured', async () => {
    const started = await runDeliveryCheck({}, newId());
    if (!started.ok) throw new Error(`the check did not start: ${started.error}`);
    expect(['waiting', 'arrived']).toContain(started.data.state);
    const status = await deliveryCheck({
      probeId: started.data.probeId,
      requestedAt: started.data.requestedAt,
    });
    expect(status).toMatchObject({ ok: true, data: { state: 'arrived' } });
    const page = await integrationHealth({ limit: 10 });
    expect(page.ok && page.data.deliveryCheck?.probeId).toBe(started.data.probeId);
  });

  it('refuses the delivery check to a manager, and a check it cannot read', async () => {
    request.principal = manager;
    expect(await runDeliveryCheck({}, newId())).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await deliveryCheck({ probeId: newId(), requestedAt: new Date().toISOString() }),
    ).toEqual({ ok: false, error: 'forbidden' });
    request.principal = executive;
    expect(await deliveryCheck({ probeId: 'mine', requestedAt: 'now' })).toMatchObject({
      ok: false,
      error: 'validation_failed',
    });
  });
});
