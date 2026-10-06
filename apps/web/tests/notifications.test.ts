import {
  ErrorEnvelope,
  newId,
  NotificationScanWorkerResponse,
  NotifyResult,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DeliveredEvent,
  type Principal,
} from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  asMigrator,
  closeDb,
  createTestTeam,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import {
  executeCommand,
  memoryKeyValue,
  notifyEvent,
  subscribePush as subscribeCommand,
} from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The notify worker, its scan and the forms' routed enquiries outside a Next.js request
// (docs/design/phase1.md §8.1): the queue client, the request headers and the signed-in caller
// are stand-ins, and pushes go to a stand-in sender; the signature checks, the commands and the
// database are real.
const queue = vi.hoisted(() => ({ published: [] as unknown[] }));
const request = vi.hoisted(() => ({
  principal: undefined as Principal | undefined,
  headers: new Headers(),
}));

vi.mock('@upstash/qstash', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Client: class {
    publishJSON(message: unknown) {
      queue.published.push(message);
      return Promise.resolve({ messageId: 'test-message' });
    }
  },
}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(request.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));
vi.mock('../src/auth/current-principal', () => ({
  currentPrincipal: () => Promise.resolve(request.principal),
  currentSession: () => Promise.resolve(undefined),
  forgetPrincipal: () => Promise.resolve(),
}));

const { POST: notifyRoute } = await import('../src/app/api/v1/workers/notify/route');
const { POST: scanRoute } = await import('../src/app/api/v1/workers/notifications/scan/route');
const { runNotificationScan, notificationScanRunId } = await import('../src/workers/notify/scan');
const { deliverNoticeBatch, pushMessageOf } = await import('../src/workers/notify/deliver-notices');
const { deliverEvent } = await import('../src/workers/events/deliver');
const { workerFor } = await import('../src/workers/events/registry');
const { fakePushSender } = await import('../src/notifications/push');
const { createLead, takeEnquiry } = await import('../src/actions/crm');
const {
  listNotices,
  markAllNoticesRead,
  noticeCount,
  notificationSettings,
  saveNotificationSettings,
} = await import('../src/actions/notifications');

afterAll(async () => {
  await closeAuthDb();
  await closeOutboxDb();
  await closeDb();
});

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'notify-route-test-current-signing-key';
const ORIGIN = 'http://localhost:3000';
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];
const saved = new Map<string, string | undefined>();

function withQueue() {
  for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'notify-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'notify-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = ORIGIN;
}
function restore() {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  saved.clear();
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the route and the body's hash. */
function sign(url: string, body: string, key = CURRENT_KEY): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: url,
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

function post(
  handler: (request: Request) => Promise<Response>,
  url: string,
  body: string,
  signature?: string,
): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== undefined) headers.set('upstash-signature', signature);
  return handler(new Request(url, { method: 'POST', headers, body }));
}

const RUN = newId().slice(-6);
let numbers = 0;
function phone(): string {
  numbers += 1;
  return `95${RUN.replace(/[^0-9]/g, '3')
    .padEnd(6, '3')
    .slice(0, 6)}${String(numbers).padStart(2, '0')}`;
}

let owner: Principal;
let colleague: Principal;
let teamLead: Principal;

beforeAll(async () => {
  const team = await createTestTeam(1, 'notify worker team');
  const o = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId: team }], {
    name: 'Neha Owner',
  });
  const c = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId: team }]);
  const t = await createTestUser([{ entityId: 1, roleKey: 'sales_team_lead', teamId: team }]);
  owner = principalFor('tele_caller_cc', [1], { id: o.id, teamId: team });
  colleague = principalFor('tele_caller_lc', [1], { id: c.id, teamId: team });
  teamLead = principalFor('sales_team_lead', [1], { id: t.id, teamId: team });
});
beforeEach(() => {
  queue.published.length = 0;
  request.principal = undefined;
  request.headers = new Headers();
});
afterEach(restore);

function ok<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

/** A lead of company 1 owned by `principal`, through the action the forms use. */
async function lead(principal: Principal, number = phone()) {
  request.principal = principal;
  const made = ok(
    await createLead({
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: `Notify customer ${RUN}`, phone: number },
      account: { type: 'farm' },
      site: { type: 'borewell', village: 'Notify village' },
    }),
  );
  return made;
}

function assignedEvent(opportunityId: string, ownerId: string, by: string): DeliveredEvent {
  return {
    id: newId(),
    sequence: '1',
    type: 'crm.opportunity.assigned',
    entityId: 1,
    aggregateType: 'opportunity',
    aggregateId: opportunityId,
    payload: { ownerId, teamId: null, lockHours: 48, assignedById: by, v: 1 },
  };
}

async function noticesAbout(subjectId: string) {
  return asMigrator(
    (m) => m<{ user_id: string; type: string; channel_sent_json: Record<string, unknown> }[]>`
      select user_id, type, channel_sent_json from notifications where subject_id = ${subjectId}`,
  );
}

const NOTIFY_URL = `${ORIGIN}/api/v1/workers/notify`;

describe('POST /api/v1/workers/notify', () => {
  it('answers 503 where the queue is not configured, and refuses a call QStash did not sign', async () => {
    const body = JSON.stringify(assignedEvent(newId(), newId(), newId()));
    expect((await post(notifyRoute, NOTIFY_URL, body)).status).toBe(503);
    withQueue();
    const unsigned = await post(notifyRoute, NOTIFY_URL, body);
    expect(unsigned.status).toBe(401);
    expect(ErrorEnvelope.parse(await unsigned.json()).error.code).toBe('unauthorized');
    const otherKey = await post(notifyRoute, NOTIFY_URL, body, sign(NOTIFY_URL, body, 'other-key'));
    expect(otherKey.status).toBe(401);
  });

  it('refuses for good an event that does not notify, or a payload that is not its type’s', async () => {
    withQueue();
    for (const event of [
      { ...assignedEvent(newId(), newId(), newId()), type: 'crm.lead.created' },
      {
        ...assignedEvent(newId(), newId(), newId()),
        payload: { ownerId: newId(), name: 'Ramesh', v: 1 },
      },
    ]) {
      const body = JSON.stringify(event);
      const response = await post(notifyRoute, NOTIFY_URL, body, sign(NOTIFY_URL, body));
      expect(response.status).toBe(400);
      expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
    }
  });

  it('writes the assignment notice for the new owner once, and answers a repeat as a duplicate', async () => {
    withQueue();
    const made = await lead(owner);
    await asMigrator(
      (m) => m`update opportunities set owner_id = ${colleague.id} where id = ${made.id}`,
    );
    const body = JSON.stringify(assignedEvent(made.id, colleague.id, teamLead.id));
    const first = NotifyResult.parse(
      await (await post(notifyRoute, NOTIFY_URL, body, sign(NOTIFY_URL, body))).json(),
    );
    expect(first).toMatchObject({ outcome: 'done', created: 1, pushed: 0, heldForQuietHours: 0 });
    const again = NotifyResult.parse(
      await (await post(notifyRoute, NOTIFY_URL, body, sign(NOTIFY_URL, body))).json(),
    );
    expect(again.outcome).toBe('duplicate');
    expect((await noticesAbout(made.id)).map((n) => [n.user_id, n.type])).toEqual([
      [colleague.id, 'lead_assigned'],
    ]);
  });
});

describe('the notify worker without a queue (in process)', () => {
  it('handles a notifying event through its registered worker', async () => {
    const made = await lead(owner);
    await asMigrator(
      (m) => m`update opportunities set owner_id = ${colleague.id} where id = ${made.id}`,
    );
    const worker = workerFor('crm.opportunity.assigned');
    expect(worker).toBeDefined();
    const result = await deliverEvent(assignedEvent(made.id, colleague.id, teamLead.id), {
      keyValue: memoryKeyValue(),
      requestId: 'notify-in-process',
    });
    expect(result.outcome).toBe('done');
    expect((await noticesAbout(made.id)).map((n) => n.user_id)).toEqual([colleague.id]);
  });
});

describe('pushes (docs/design/phase1.md §8.1)', () => {
  const workers = principalFor('system:workers', [1], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
  const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };

  it('sends to the person’s browsers, records it, and removes a browser the service says is gone', async () => {
    const live = `https://fcm.googleapis.com/fcm/send/${newId()}`;
    const gone = `https://updates.push.services.mozilla.com/wpush/v2/${newId()}`;
    for (const endpoint of [live, gone]) {
      await executeCommand(colleague, {}, subscribeCommand, { endpoint, keys });
    }
    const made = await lead(owner);
    await asMigrator(
      (m) => m`update opportunities set owner_id = ${colleague.id} where id = ${made.id}`,
    );
    const batch = await executeCommand(workers, { entityIds: [1] }, notifyEvent, {
      event: 'crm.opportunity.assigned',
      entityId: 1,
      eventId: newId(),
      opportunityId: made.id,
      ownerId: colleague.id,
      assignedById: teamLead.id,
    });
    const notice = batch.notices[0];
    if (notice === undefined) throw new Error('expected a notice');
    expect(notice.push).toBe('send');
    const sender = fakePushSender({ [gone]: 'gone' });
    const counts = await deliverNoticeBatch(workers, batch, { requestId: 'push-test', sender });
    expect(counts).toEqual({ created: 1, pushed: 1, heldForQuietHours: 0 });
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual([gone, live].sort());
    // The alert carries the kind's sentence and the screen, never the customer's name.
    const message = sender.sent[0]?.message;
    expect(message?.url).toBe(`/customers/${made.account.id}?company=1`);
    expect(JSON.stringify(message)).not.toContain('Notify customer');
    expect(message).toEqual(pushMessageOf(notice));
    const browsers = await asMigrator(
      (m) => m<{ endpoint: string; last_ok_at: Date | null }[]>`
        select endpoint, last_ok_at from push_subscriptions where endpoint in (${live}, ${gone})`,
    );
    expect(browsers.map((b) => b.endpoint)).toEqual([live]);
    expect(browsers[0]?.last_ok_at).not.toBeNull();
    expect((await noticesAbout(made.id))[0]?.channel_sent_json).toEqual({
      inApp: true,
      push: 'sent',
    });
  });
});

describe('POST /api/v1/workers/notifications/scan', () => {
  const SCAN_URL = `${ORIGIN}/api/v1/workers/notifications/scan`;

  it('refuses an unsigned call, and a body that names work without its company', async () => {
    withQueue();
    expect((await post(scanRoute, SCAN_URL, '{}')).status).toBe(401);
    const body = JSON.stringify({ afterId: 'more' });
    const response = await post(scanRoute, SCAN_URL, body, sign(SCAN_URL, body));
    expect(response.status).toBe(400);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
  });

  it('scans every live company in turn for a signed call, and tells a person of their call due', async () => {
    withQueue();
    const made = await lead(owner);
    const task = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind, due_at, created_by)
        values (${task}, 1, ${made.id}, ${made.account.id}, ${owner.id}, 'callback', now() - interval '1 minute', ${owner.id})`,
    );
    const response = await post(scanRoute, SCAN_URL, '{}', sign(SCAN_URL, '{}'));
    expect(response.status).toBe(200);
    const result = NotificationScanWorkerResponse.parse(await response.json());
    expect(result.batches).toBeGreaterThanOrEqual(4);
    expect(result.done).toBe(true);
    expect((await noticesAbout(task)).map((n) => [n.user_id, n.type])).toEqual([
      [owner.id, 'call_due'],
    ]);
  }, 120_000);

  it('hands the rest to a fresh call when its time is spent, named by the run’s minute', async () => {
    withQueue();
    const at = Date.parse('2031-03-04T10:05:30Z');
    const result = await runNotificationScan({ entityId: 2 }, { budgetMs: 0, now: () => at });
    expect(result).toEqual({ batches: 0, created: 0, done: false });
    expect(queue.published).toEqual([
      expect.objectContaining({
        url: SCAN_URL,
        body: { runDate: '2031-03-04T10:05', entityId: 2 },
        deduplicationId: 'notification-scan-2031-03-04T10:05-2-start',
      }),
    ]);
    expect(
      notificationScanRunId({ runDate: '2031-03-04T10:05', entityId: 3, afterId: 'more' }),
    ).toBe('notification-scan-2031-03-04T10:05-3-more');
  });
});

describe('the forms’ save, the bell and the settings (server actions)', () => {
  it('passes an enquiry for a colleague’s customer to them, by name, and tells them', async () => {
    const number = phone();
    await lead(owner, number);
    request.principal = colleague;
    const routed = ok(
      await takeEnquiry({
        entityId: 1,
        pipelineKey: 'farmer_pumps',
        contact: { name: `Notify customer ${RUN}`, phone: number },
        account: { type: 'farm' },
      }),
    );
    expect(routed).toMatchObject({ outcome: 'routed', colleagueName: 'Neha Owner' });
    if (routed.outcome !== 'routed') throw new Error('expected a routed enquiry');
    // Without a queue the publisher runs in this process after the commit, so the notice follows.
    let told: { user_id: string; type: string }[] = [];
    for (let i = 0; i < 40 && told.length === 0; i += 1) {
      told = await noticesAbout(routed.itemId);
      if (told.length === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(told.map((n) => [n.user_id, n.type])).toEqual([[owner.id, 'enquiry_routed']]);
    // The plain createLead action still refuses it, as an import row is refused.
    expect(
      await createLead({
        entityId: 1,
        pipelineKey: 'farmer_pumps',
        contact: { name: `Notify customer ${RUN}`, phone: number },
        account: { type: 'farm' },
      }),
    ).toMatchObject({ ok: false, error: 'customer_held_by_colleague' });
  });

  it('counts, lists and clears a person’s notices, and saves their settings', async () => {
    request.principal = owner;
    const page = ok(await listNotices({ limit: 10 }));
    expect(page.items.length).toBeGreaterThan(0);
    expect(ok(await noticeCount()).unread).toBeGreaterThanOrEqual(0);
    ok(await markAllNoticesRead(newId()));
    expect(ok(await noticeCount())).toEqual({ unread: 0 });
    const settings = ok(
      await saveNotificationSettings(
        {
          types: [{ type: 'call_due', inApp: true, push: false }],
          quietFrom: '22:00',
          quietTo: '07:00',
        },
        newId(),
      ),
    );
    expect(settings).toMatchObject({ quietFrom: '22:00', quietTo: '07:00' });
    expect(ok(await notificationSettings()).types).toContainEqual({
      type: 'call_due',
      inApp: true,
      push: false,
    });
    expect(
      await saveNotificationSettings({ types: [], quietFrom: '22:00', quietTo: null }, newId()),
    ).toMatchObject({ ok: false, error: 'quiet_hours_incomplete', field: 'quietTo' });
  });
});
