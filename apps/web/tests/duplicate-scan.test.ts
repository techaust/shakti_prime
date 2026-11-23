import { ErrorEnvelope, DuplicateScanWorkerResponse, newId } from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { asMigrator, closeDb, createTestPrincipal, createTestTeam } from '@shakti/db/testing';
import type * as Domain from '@shakti/domain';
import { createHash, createHmac, randomInt } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The nightly duplicate search outside a Next.js request: the queue client is a stand-in,
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

// Where each company's search starts while a case sets it: right after the id minted when the case
// began, so the case searches only the customers it made and not every customer earlier runs left
// in the shared database. The command, its definer and the walk through the companies are real.
const scan = vi.hoisted(() => ({ startAfter: null as string | null }));

vi.mock('@shakti/domain', async (original) => {
  const domain = await original<typeof Domain>();
  const executeCommand: typeof domain.executeCommand = (
    principal,
    scope,
    command,
    input,
    options,
  ) =>
    domain.executeCommand(
      principal,
      scope,
      command,
      command.name === 'crm.duplicate.scan' &&
        scan.startAfter !== null &&
        (input as { afterId: string | null }).afterId === null
        ? { ...(input as object), afterId: scan.startAfter }
        : input,
      options,
    );
  return { ...domain, executeCommand };
});

const { POST } = await import('../src/app/api/v1/workers/crm/duplicates/route');
const { duplicateScanRunId, runDuplicateScan } = await import('../src/workers/duplicate-scan');

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'duplicates-route-test-current-signing-key';
const ROUTE_URL = 'http://localhost:3000/api/v1/workers/crm/duplicates';
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'duplicates-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'duplicates-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  queue.published.length = 0;
});
afterEach(() => {
  scan.startAfter = null;
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

/** The companies the search walks: from company 1 up to the first number none has, less archived. */
async function liveCompanies(): Promise<number[]> {
  const rows = await asMigrator(
    (m) => m<{ id: number; archived: boolean }[]>`
      select id, archived_at is not null as archived from entities order by id`,
  );
  const live: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.id !== index + 1) break;
    if (!row.archived) live.push(row.id);
  }
  return live;
}

const RUN = newId().slice(-6);

/**
 * A mobile number no contact holds yet: 8 random digits, drawn again while the number is taken.
 * Earlier runs' customers stay in the shared database and the scan looks around every customer of
 * a company, so a number an earlier run drew would pair with this run's (p3-fixes review, finding 1).
 */
async function unusedPhone(draw: () => number = () => randomInt(100_000_000)): Promise<string> {
  for (let tries = 0; tries < 20; tries += 1) {
    const e164 = `+9193${String(draw()).padStart(8, '0')}`;
    const [row] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from contact_phones where e164 = ${e164}`,
    );
    if (row?.n === 0) return e164;
  }
  throw new Error('No unused number in 20 draws');
}

/**
 * Two customers of one company with one mobile number of this run only, written past the policies
 * as an import commits them, so lead creation records no card for them and only the search can.
 */
async function customersSharingAPhone(
  entityId: number,
): Promise<{ entityId: number; first: string; second: string; e164: string }> {
  const team = await createTestTeam(entityId, `duplicate scan route ${RUN}`);
  const owner = await createTestPrincipal('tele_caller_cc', [entityId], { teamId: team });
  const e164 = await unusedPhone();
  const [first, second] = [newId(), newId()];
  await asMigrator((m) =>
    m.begin(async (tx) => {
      for (const [n, accountId] of [first, second].entries()) {
        const contactId = newId();
        const name = `Scan ${RUN} ${String(entityId)} ${String(n)}`;
        await tx`insert into accounts (id, type, name, created_by)
          values (${accountId}, 'farm', ${name}, ${owner.id})`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
          values (${newId()}, ${accountId}, ${entityId}, ${owner.id}, ${team}, ${owner.id})`;
        await tx`insert into contacts (id, name, created_by) values (${contactId}, ${name}, ${owner.id})`;
        await tx`insert into account_contacts (account_id, contact_id, role, created_by)
          values (${accountId}, ${contactId}, 'owner', ${owner.id})`;
        await tx`insert into contact_phones (id, contact_id, e164, is_primary, created_by)
          values (${newId()}, ${contactId}, ${e164}, true, ${owner.id})`;
      }
    }),
  );
  return { entityId, first, second, e164 };
}

/** The cards that name a customer. */
function candidatesOf(accountId: string) {
  return asMigrator(
    (m) => m<{ entity_id: number; kind: string; other: string | null; reason: string }[]>`
      select entity_id, kind, reason,
             case when account_id = ${accountId} then other_account_id else account_id end as other
        from duplicate_candidates
       where ${accountId} in (account_id, other_account_id)`,
  );
}

function call(body: string, signature?: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== undefined) headers.set('upstash-signature', signature);
  return POST(new Request(ROUTE_URL, { method: 'POST', headers, body }));
}

describe('POST /api/v1/workers/crm/duplicates', () => {
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
    ['a customer without its company', () => ({ afterId: newId() })],
    ['a night that is not a date', () => ({ runDate: 'yesterday' })],
  ])('refuses for good a body that names %s', async (_label, bodyFor) => {
    const body = JSON.stringify(bodyFor());
    const response = await call(body, sign(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
  });

  it('gives each pair a number no contact holds, drawing again when one is taken', async () => {
    const taken = await customersSharingAPhone(1);
    const fresh = randomInt(100_000_000);
    const draws = [Number(taken.e164.slice(-8)), fresh];
    expect(await unusedPhone(() => draws.shift() ?? fresh)).toBe(
      `+9193${String(fresh).padStart(8, '0')}`,
    );
    expect(draws).toEqual([]);
  });

  it('searches every live company in turn for a signed call, and is done', async () => {
    scan.startAfter = newId();
    const companies = await liveCompanies();
    const pairs = [];
    for (const entityId of companies) pairs.push(await customersSharingAPhone(entityId));

    const response = await call('{}', sign('{}'));
    expect(response.status).toBe(200);
    const result = DuplicateScanWorkerResponse.parse(await response.json());
    expect(result.done).toBe(true);
    // At least one batch for each live company, and nothing handed on.
    expect(result.batches).toBeGreaterThanOrEqual(companies.length);
    expect(result.found).toBeGreaterThanOrEqual(companies.length);
    expect(queue.published).toEqual([]);
    // Each company's own pair is a card of that company.
    for (const pair of pairs) {
      expect(await candidatesOf(pair.first)).toEqual([
        {
          entity_id: pair.entityId,
          kind: 'customer',
          other: pair.second,
          reason: 'phone',
        },
      ]);
    }
    // Its own time limit: the run is bounded by what the case made, whatever the database holds.
  }, 60_000);
});

describe('the duplicate search run', () => {
  it('hands the rest to a fresh call when its time is spent, once for each place it stopped', async () => {
    const night = Date.parse('2031-03-04T21:30:00Z');
    const result = await runDuplicateScan({ entityId: 2 }, { budgetMs: 0, now: () => night });
    expect(result).toEqual({ batches: 0, found: 0, done: false });
    expect(queue.published).toEqual([
      expect.objectContaining({
        url: ROUTE_URL,
        body: { runDate: '2031-03-04', entityId: 2 },
        deduplicationId: 'duplicate-scan-2031-03-04-2-start',
      }),
    ]);
    const after = newId();
    expect(duplicateScanRunId({ runDate: '2031-03-04', entityId: 3, afterId: after })).toBe(
      `duplicate-scan-2031-03-04-3-${after}`,
    );
  });

  it('carries the night of its first call through every hand-over, so a later night never repeats an id (M1)', async () => {
    // A hand-over received after midnight keeps the night its run started on.
    const afterMidnight = Date.parse('2031-03-05T00:10:00Z');
    await runDuplicateScan(
      { runDate: '2031-03-04', entityId: 2 },
      { budgetMs: 0, now: () => afterMidnight },
    );
    // The next night stops at the same place, and its hand-over is not taken for a repeat.
    const nextNight = Date.parse('2031-03-05T21:30:00Z');
    await runDuplicateScan({ entityId: 2 }, { budgetMs: 0, now: () => nextNight });
    const sent = (queue.published as { deduplicationId: string; body: unknown }[]).map((m) => [
      m.deduplicationId,
      m.body,
    ]);
    expect(sent).toEqual([
      ['duplicate-scan-2031-03-04-2-start', { runDate: '2031-03-04', entityId: 2 }],
      ['duplicate-scan-2031-03-05-2-start', { runDate: '2031-03-05', entityId: 2 }],
    ]);
  });

  it('stops at the first number no company has', async () => {
    const result = await runDuplicateScan({ entityId: 99 }, {});
    expect(result).toEqual({ batches: 0, found: 0, done: true });
  });
});
