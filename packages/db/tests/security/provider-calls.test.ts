import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asMigrator, asPrincipal, closeDb, principalFor } from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// T3 Click-to-dial and recordings (docs/03-roadmap-appendix/phase2.md §6.3, migration 0169): a
// provider call is read with its lead; a person inserts only a dialling call of their own on a
// lead their calls.dial scope covers, for a phone of its customer, and afterwards changes only the
// link to their own log of it; the platform (calls.process) writes the rest through definers that
// refuse everyone else; a recording is handed out only to a listener whose scope covers the lead;
// and only the caller sets their own dial phone. The role × company read is in
// role-entity-matrix.test.ts. The suites never clean these tables, so every row here is found by
// this run's own ids.

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

const workers = (entityId: number): Principal => ({
  ...principalFor('system:workers', [entityId]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

let fx: CrmFixture;
let a: Principal;
let b: Principal;
let lead: Principal;
let gm: Principal;

function leadOf(owner: keyof CrmFixture['leads']): string {
  const id = fx.leads[owner][0];
  if (!id) throw new Error(`fixture lead ${owner} missing`);
  return id;
}

async function phoneOf(owner: keyof CrmFixture['contacts']): Promise<string> {
  const contact = fx.contacts[owner][0] ?? '';
  const [row] = await asMigrator(
    (m) => m<{ id: string }[]>`select id from contact_phones where contact_id = ${contact} limit 1`,
  );
  if (!row) throw new Error(`fixture phone ${owner} missing`);
  return row.id;
}

/** A dialling call of `who`'s, as the dial command writes it; `overrides` are SQL column values. */
function dialling(
  who: Principal,
  owner: keyof CrmFixture['leads'],
  phone: string,
  overrides: { status?: string; callerId?: string; id?: string } = {},
): Promise<unknown[]> {
  return rows(
    who,
    sql`insert into provider_calls (id, entity_id, opportunity_id, contact_phone_id, caller_id,
                                    direction, series, purpose, status, started_at)
        values (${overrides.id ?? newId()}, 1, ${leadOf(owner)}, ${phone},
                ${overrides.callerId ?? who.id}, 'outbound', '140', 'promotional',
                ${overrides.status ?? 'dialling'}, now())`,
  );
}

beforeAll(async () => {
  fx = await crmFixture();
  ({ a, b, l: lead, gm } = fx.principals);
});

describe('provider_calls', () => {
  it("is inserted only as the caller's own dialling call, on a lead they may dial, for its customer's phone", async () => {
    const phoneA = await phoneOf('a');
    const phoneB = await phoneOf('b');
    const own = newId();
    await dialling(a, 'a', phoneA, { id: own });
    // Read with the lead: the caller and their team lead; not a colleague who cannot read it.
    const read = sql`select id from provider_calls where id = ${own}`;
    expect(await rows(a, read)).toHaveLength(1);
    expect(await rows(lead, read)).toHaveLength(1);
    expect(await rows(b, read)).toHaveLength(0);
    expect(await rows(fx.principals.d, read)).toHaveLength(0);

    // Not as someone else, not already ended, not on another's lead, not to another customer's phone.
    for (const attempt of [
      dialling(a, 'a', phoneA, { callerId: b.id }),
      dialling(a, 'a', phoneA, { status: 'completed' }),
      dialling(a, 'b', phoneB),
      dialling(a, 'a', phoneB),
    ]) {
      expect(await failure(attempt)).toMatch(/row-level security/);
    }
    // Never an agent or the platform, whatever they hold.
    const agent = {
      ...principalFor('agent:triage', [1]),
      permissions: [{ key: 'calls.dial' as const, scope: 'all' as const }],
    };
    expect(await failure(dialling(agent, 'a', phoneA))).toMatch(/row-level security/);
    expect(await failure(dialling(workers(1), 'a', phoneA))).toMatch(/row-level security/);
  });

  it("changes after its insert only the link to the caller's own log of it, once", async () => {
    const phoneA = await phoneOf('a');
    const id = newId();
    await dialling(a, 'a', phoneA, { id });
    expect(
      await failure(rows(a, sql`update provider_calls set status = 'completed' where id = ${id}`)),
    ).toMatch(/permission denied/);
    const [outcome] = await asMigrator(
      (m) => m<{ id: string }[]>`
        select id from call_dispositions
         where entity_id is null and segment is null and archived_at is null
         order by position limit 1`,
    );
    const call = newId();
    const other = newId();
    await rows(
      a,
      sql`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series,
                             disposition_id, attempt_no, started_at)
          values (${call}, 1, ${leadOf('a')}, ${a.id}, 'outbound', '140', ${outcome?.id ?? ''}, 1, now()),
                 (${other}, 1, ${leadOf('a')}, ${a.id}, 'outbound', '140', ${outcome?.id ?? ''}, 1, now())`,
    );
    // A colleague's update finds no row of theirs.
    expect(
      await rows(b, sql`update provider_calls set call_id = ${call} where id = ${id} returning id`),
    ).toHaveLength(0);
    expect(
      await rows(a, sql`update provider_calls set call_id = ${call} where id = ${id} returning id`),
    ).toHaveLength(1);
    // Linked once: another log of the same call finds nothing to link.
    expect(
      await rows(
        a,
        sql`update provider_calls set call_id = ${other} where id = ${id} returning id`,
      ),
    ).toHaveLength(0);
  });
});

describe("the platform's definers (calls.process)", () => {
  it('refuse every person and agent, and a company outside the request', async () => {
    const phoneA = await phoneOf('a');
    const id = newId();
    await dialling(a, 'a', phoneA, { id });
    const calls: SQL[] = [
      sql`select * from app.record_provider_call(1::smallint, ${id}::uuid, null, 'completed', null, null, 10)`,
      sql`select * from app.attach_call_recording(1::smallint, ${id}::uuid, ${newId()}::uuid, 'b',
            'k', 'n', 'audio/mpeg', 1, ${'a'.repeat(64)})`,
      sql`select * from app.call_recordings_due(now(), 10)`,
      sql`select app.drop_call_recording(1::smallint, ${newId()}::uuid)`,
    ];
    for (const who of [a, lead, gm, principalFor('agent:copilot', [1])]) {
      for (const query of calls) {
        expect(await failure(rows(who, query))).toMatch(/calls.process is required/);
      }
    }
    expect(
      await failure(
        rows(
          workers(2),
          sql`select * from app.record_provider_call(1::smallint, ${id}::uuid, null, 'completed', null, null, 10)`,
        ),
      ),
    ).toMatch(/outside the request/);
    // The platform records what the provider said; the status only moves forward.
    const recorded = await rows<{ outcome: string; status: string }>(
      workers(1),
      sql`select outcome, status from app.record_provider_call(1::smallint, ${id}::uuid, null, 'completed', null, null, 10)`,
    );
    expect(recorded).toEqual([{ outcome: 'moved', status: 'completed' }]);
    const again = await rows<{ outcome: string; status: string }>(
      workers(1),
      sql`select outcome, status from app.record_provider_call(1::smallint, ${id}::uuid, null, 'ringing', null, null, null)`,
    );
    expect(again).toEqual([{ outcome: 'unchanged', status: 'completed' }]);
  });

  it('hand a recording out only to a person whose listen scope covers the lead', async () => {
    const phoneA = await phoneOf('a');
    const id = newId();
    const file = newId();
    await dialling(a, 'a', phoneA, { id });
    await rows(
      workers(1),
      sql`select * from app.record_provider_call(1::smallint, ${id}::uuid, null, 'completed', null, null, 10)`,
    );
    const attached = await rows<{ outcome: string }>(
      workers(1),
      sql`select outcome from app.attach_call_recording(1::smallint, ${id}::uuid, ${file}::uuid, 'test',
            ${`1/call_recording/${file}.mp3`}, 'call-recording.mp3', 'audio/mpeg', 10, ${'b'.repeat(64)})`,
    );
    expect(attached).toEqual([{ outcome: 'attached' }]);
    const play = sql`select file_id from app.call_recording_to_play(${id}::uuid)`;
    // The team lead of the lead's team and the General Manager hear it.
    expect(await rows(lead, play)).toEqual([{ file_id: file }]);
    expect(await rows(gm, play)).toEqual([{ file_id: file }]);
    // The caller holds no listen grant, the platform is not a person, and no one reads the file.
    expect(await failure(rows(a, play))).toMatch(/calls.recording.listen is required/);
    expect(await failure(rows(workers(1), play))).toMatch(/calls.recording.listen is required/);
    for (const who of [a, lead, gm]) {
      expect(await rows(who, sql`select id from files where id = ${file}`)).toHaveLength(0);
    }
  });
});

describe("a caller's dial phone", () => {
  it('is set by the caller alone, never by a manager', async () => {
    await asMigrator(
      (m) => m`delete from caller_profiles where user_id = ${a.id} and entity_id = 1`,
    );
    // The General Manager manages every profile of the company, but never sets the caller's phone.
    const managed = sql`insert into caller_profiles (id, user_id, entity_id, dial_phone_e164)
                        values (${newId()}, ${a.id}, 1, '+919800000501')`;
    expect(await failure(rows(gm, managed))).toMatch(/row-level security/);
    await rows(
      gm,
      sql`insert into caller_profiles (id, user_id, entity_id, max_open)
          values (${newId()}, ${a.id}, 1, 20)`,
    );
    expect(
      await failure(
        rows(
          gm,
          sql`update caller_profiles set dial_phone_e164 = '+919800000502'
               where user_id = ${a.id} and entity_id = 1`,
        ),
      ),
    ).toMatch(/own dial phone/);
    expect(
      await rows(
        a,
        sql`update caller_profiles set dial_phone_e164 = '+919800000503'
             where user_id = ${a.id} and entity_id = 1 returning dial_phone_e164`,
      ),
    ).toEqual([{ dial_phone_e164: '+919800000503' }]);
    // The manager still changes the rest of the profile.
    expect(
      await rows(
        gm,
        sql`update caller_profiles set max_open = 25
             where user_id = ${a.id} and entity_id = 1 returning dial_phone_e164`,
      ),
    ).toEqual([{ dial_phone_e164: '+919800000503' }]);
  });
});
