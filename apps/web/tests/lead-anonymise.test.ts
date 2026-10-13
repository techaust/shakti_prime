import { ErrorEnvelope, LeadAnonymiseWorkerResponse, newId } from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { asMigrator, closeDb, PIPELINE_SEED } from '@shakti/db/testing';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The nightly anonymisation worker outside a Next.js request: the queue client is a stand-in,
// the signature check, the command and the database are real. Which leads it anonymises is
// proved in packages/db (lead-anonymise.test.ts) and packages/domain.
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

const { POST } = await import('../src/app/api/v1/workers/crm/anonymise/route');
const { leadAnonymiseRunId, runLeadAnonymise } = await import('../src/workers/lead-anonymise');

/** One lead of company 4 idle since 2001, on a customer of its own, so a run has one to find. */
beforeAll(async () => {
  const pipeline = PIPELINE_SEED[0];
  if (pipeline === undefined) throw new Error('pipeline seed missing');
  const [account, contact, lead, actor] = [newId(), newId(), newId(), newId()];
  const at = '2001-05-01T00:00:00Z';
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const [stage] = await tx<{ id: string }[]>`
        select id from pipeline_stages where pipeline_id = ${pipeline.id} and key = 'new'`;
      await tx`insert into principals (id, kind, display_name) values (${actor}, 'user', 'worker fixture')`;
      await tx`insert into contacts (id, name, created_by, created_at, updated_at)
               values (${contact}, 'worker fixture person', ${actor}, ${at}, ${at})`;
      await tx`insert into accounts (id, type, name, created_by, created_at, updated_at)
               values (${account}, 'farm', 'worker fixture customer', ${actor}, ${at}, ${at})`;
      await tx`insert into account_entities (id, account_id, entity_id, created_by, created_at, updated_at)
               values (${newId()}, ${account}, 4, ${actor}, ${at}, ${at})`;
      await tx`insert into account_contacts (account_id, contact_id, role, created_by, created_at, updated_at)
               values (${account}, ${contact}, 'owner', ${actor}, ${at}, ${at})`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, created_by,
                                          created_at, updated_at, state_changed_at)
               values (${lead}, 4, ${account}, ${pipeline.id}, ${stage?.id ?? ''}, ${actor}, ${at}, ${at}, ${at})`;
    }),
  );
});

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'lead-anonymise-test-current-signing-key';
const ROUTE_URL = 'http://localhost:3000/api/v1/workers/crm/anonymise';
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'lead-anonymise-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'lead-anonymise-test-next-signing-key';
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

describe('POST /api/v1/workers/crm/anonymise', () => {
  it.each([
    ['no signature', () => undefined],
    ['a signature made with another key', (body: string) => sign(body, 'some-other-signing-key')],
    ['a signature of another body', () => sign('{"dryRun":true}')],
    [
      'a signature for another route',
      (body: string) => sign(body, CURRENT_KEY, 'http://localhost:3000/api/v1/workers/crm/rescore'),
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

  it('refuses for good a body it does not know', async () => {
    const body = JSON.stringify({ entityId: 2 });
    const response = await call(body, sign(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
  });

  it('counts in a dry run, and then runs every live company in turn, finding what it counted', async () => {
    const dryBody = JSON.stringify({ dryRun: true });
    const dry = await call(dryBody, sign(dryBody));
    expect(dry.status).toBe(200);
    const counted = LeadAnonymiseWorkerResponse.parse(await dry.json());
    expect(counted).toMatchObject({ dryRun: true, done: true, failedCustomers: 0 });
    expect(counted.batches).toBeGreaterThanOrEqual(4);
    expect(counted.anonymised).toBeGreaterThanOrEqual(1);

    const response = await call('{}', sign('{}'));
    expect(response.status).toBe(200);
    const result = LeadAnonymiseWorkerResponse.parse(await response.json());
    expect(result).toMatchObject({ dryRun: false, done: true, failedCustomers: 0 });
    // At least one batch for each of the four companies; the dry run found what the run did.
    expect(result.batches).toBeGreaterThanOrEqual(4);
    expect(result.anonymised).toBe(counted.anonymised);
  }, 120_000);
});

describe('the anonymisation run', () => {
  it('hands the rest to a fresh call when its time is spent, so every company is reached', async () => {
    const night = Date.parse('2031-03-04T22:30:00Z');
    const result = await runLeadAnonymise({ entityId: 2 }, { budgetMs: 0, now: () => night });
    expect(result).toEqual({
      dryRun: false,
      batches: 0,
      examined: 0,
      anonymised: 0,
      kept: 0,
      failedCustomers: 0,
      done: false,
    });
    expect(queue.published).toEqual([
      expect.objectContaining({
        url: ROUTE_URL,
        body: { runDate: '2031-03-04', entityId: 2 },
        deduplicationId: 'lead-anonymise-2031-03-04-2-start',
      }),
    ]);
    // A dry run hands on as a dry run, and a place in a company names it in the id.
    const after = { at: '2001-02-01T00:00:00.000000Z', id: newId() };
    expect(leadAnonymiseRunId({ dryRun: true, runDate: '2031-03-04', entityId: 3, after })).toBe(
      `lead-anonymise-dry-2031-03-04-3-2001-02-01T000000.000000Z-${after.id}`,
    );
  });

  it('stops at the first number no company has', async () => {
    const result = await runLeadAnonymise({ entityId: 99 }, {});
    expect(result).toMatchObject({ batches: 0, done: true });
  });
});
