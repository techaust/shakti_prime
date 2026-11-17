import { AGENT_PRINCIPAL_IDS, newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asMigrator, asPrincipal, closeDb, principalFor } from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// A2 Caller Co-pilot (docs/03-roadmap-appendix/phase2.md §7.3, migration copilot_notes_rls): a
// Co-pilot note is read with its lead; only the Co-pilot's own principal holding
// agents.note.write inserts one, as itself, in a company of the request, on a lead it reads, for a
// call of that lead; no request changes or removes one, and the stale-lead anonymisation alone
// removes the notes of a lead it is anonymising. A call's transcript (call_transcript) is read
// with its call. The role × company read is in role-entity-matrix.test.ts. The suites never clean
// these tables, so every row here is found by this run's own ids.

afterAll(closeDb);

/** The database's message for a refused statement (drizzle wraps it as the cause). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

async function rows<T = Record<string, unknown>>(principal: Principal, query: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(query)) as unknown as T[]);
}

const COPILOT = AGENT_PRINCIPAL_IDS['agent:copilot'];
const copilot = (entityIds: number[] = [1]) =>
  principalFor('agent:copilot', entityIds, { id: COPILOT });

let fx: CrmFixture;
let leadA: string;
let leadB: string;
let leadD: string;
/** A call on lead A with its transcript, a call on lead B, and a transcript no call names. */
const callA = newId();
const callB = newId();
const transcriptA = newId();
const loose = newId();

function insert(
  who: Principal,
  values: {
    id?: string;
    entityId?: number;
    opportunityId?: string;
    providerCallId?: string | null;
    kind?: 'brief' | 'call_summary';
    createdBy?: string;
  } = {},
): Promise<unknown[]> {
  const kind = values.kind ?? 'brief';
  return rows(
    who,
    sql`insert into copilot_notes (id, entity_id, opportunity_id, provider_call_id, kind, body, created_by)
        values (${values.id ?? newId()}, ${values.entityId ?? 1}, ${values.opportunityId ?? leadA},
                ${values.providerCallId ?? null}, ${kind}, 'Wants a 5 HP pump.',
                ${values.createdBy ?? who.id})`,
  );
}

const seen = async (who: Principal, id: string): Promise<boolean> =>
  (await rows(who, sql`select id from copilot_notes where id = ${id}`)).length === 1;

beforeAll(async () => {
  fx = await crmFixture();
  leadA = fx.leads.a[0] ?? '';
  leadB = fx.leads.b[0] ?? '';
  leadD = fx.leads.d[0] ?? '';
  const a = fx.principals.a;
  await asMigrator(async (m) => {
    for (const [file, entity] of [
      [transcriptA, 1],
      [loose, 1],
    ] as const) {
      await m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
              values (${file}, ${entity}, 'call_transcript', 'local', ${`${String(entity)}/call_transcript/${file}.txt`},
                      'transcript.txt', 'text/plain', 10, ${'e'.repeat(64)}, 'ready', ${COPILOT})`;
    }
    for (const [call, lead, owner, transcript] of [
      [callA, leadA, a.id, transcriptA],
      [callB, leadB, fx.principals.b.id, null],
    ] as const) {
      await m`insert into provider_calls (id, entity_id, opportunity_id, caller_id, direction, series, purpose, status, started_at, ended_at, transcript_file_id)
              values (${call}, 1, ${lead}, ${owner}, 'outbound', '140', 'promotional', 'completed', now(), now(), ${transcript})`;
    }
  });
});

describe('copilot_notes', () => {
  it('lets the Co-pilot record a brief and a summary of a call of the lead', async () => {
    await insert(copilot());
    await insert(copilot(), { kind: 'call_summary', providerCallId: callA });
  });

  it('refuses every other writer, even one holding agents.note.write', async () => {
    const note = [{ key: 'agents.note.write' as const, scope: 'entity' as const }];
    const people = [fx.principals.a, fx.principals.gm, principalFor('executive', [1])];
    for (const who of people) {
      expect(await failure(insert(who))).toMatch(/row-level security/);
      const holding = { ...who, permissions: [...who.permissions, ...note] };
      expect(await failure(insert(holding))).toMatch(/row-level security/);
    }
    const triage = principalFor('agent:triage', [1], {
      id: AGENT_PRINCIPAL_IDS['agent:triage'],
    });
    expect(
      await failure(insert({ ...triage, permissions: [...triage.permissions, ...note] })),
    ).toMatch(/row-level security/);
    // The Co-pilot without the grant, or writing as someone else.
    const bare = copilot();
    expect(
      await failure(
        insert({
          ...bare,
          permissions: bare.permissions.filter((g) => g.key !== 'agents.note.write'),
        }),
      ),
    ).toMatch(/row-level security/);
    expect(await failure(insert(copilot(), { createdBy: fx.principals.a.id }))).toMatch(
      /row-level security/,
    );
  });

  it('refuses another company, a lead of it, and a call of another lead', async () => {
    expect(await failure(insert(copilot([1]), { entityId: 2, opportunityId: leadD }))).toMatch(
      /row-level security/,
    );
    expect(await failure(insert(copilot([2]), { entityId: 1 }))).toMatch(/row-level security/);
    expect(
      await failure(insert(copilot(), { kind: 'call_summary', providerCallId: callB })),
    ).toMatch(/row-level security/);
  });

  it('is read with the lead, by every principal that reads the lead', async () => {
    const id = newId();
    await insert(copilot(), { id });
    const { a, b, c, l, gm, d } = fx.principals;
    expect(await seen(a, id)).toBe(true);
    expect(await seen(l, id)).toBe(true);
    expect(await seen(gm, id)).toBe(true);
    expect(await seen(copilot(), id)).toBe(true);
    expect(await seen(b, id)).toBe(false);
    expect(await seen(c, id)).toBe(false);
    expect(await seen(d, id)).toBe(false);
    expect(await seen({ ...gm, entityIds: [2] }, id)).toBe(false);
    expect(await seen(principalFor('agent:concierge', [1]), id)).toBe(false);
  });

  it('is never changed or removed by a request', async () => {
    const id = newId();
    await insert(copilot(), { id });
    for (const who of [copilot(), fx.principals.a, principalFor('executive', [1])]) {
      expect(
        await failure(rows(who, sql`update copilot_notes set body = 'changed' where id = ${id}`)),
      ).toMatch(/permission denied/);
      expect(await failure(rows(who, sql`delete from copilot_notes where id = ${id}`))).toMatch(
        /permission denied/,
      );
    }
  });

  it('is removed only for a lead the anonymisation holds in its transaction', async () => {
    const id = newId();
    await insert(copilot(), { id });
    expect(await failure(asMigrator((m) => m`delete from copilot_notes where id = ${id}`))).toMatch(
      /append-only/,
    );
    expect(
      await failure(asMigrator((m) => m`update copilot_notes set body = 'x' where id = ${id}`)),
    ).toMatch(/append-only/);
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into app.lead_anonymise_scope (tx, subject_id)
                 values (pg_catalog.pg_current_xact_id(), ${leadA})`;
        await tx`delete from copilot_notes where id = ${id}`;
        await tx`delete from app.lead_anonymise_scope where tx = pg_catalog.pg_current_xact_id()`;
      }),
    );
    const [left] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from copilot_notes where id = ${id}`,
    );
    expect(left?.n).toBe(0);
  });
});

describe('call_transcript files', () => {
  const file = async (who: Principal, id: string): Promise<boolean> =>
    (await rows(who, sql`select id from files where id = ${id}`)).length === 1;

  it('are read with their call, so with its lead, and by the file checks', async () => {
    const { a, b, l, gm, d } = fx.principals;
    expect(await file(a, transcriptA)).toBe(true);
    expect(await file(l, transcriptA)).toBe(true);
    expect(await file(gm, transcriptA)).toBe(true);
    expect(await file(copilot(), transcriptA)).toBe(true);
    expect(await file(b, transcriptA)).toBe(false);
    expect(await file(d, transcriptA)).toBe(false);
    expect(await file(principalFor('system:workers', [1]), transcriptA)).toBe(true);
  });

  it('are read by no request when no call names them', async () => {
    for (const who of [fx.principals.a, fx.principals.gm, principalFor('executive', [1])]) {
      expect(await file(who, loose)).toBe(false);
    }
  });
});
