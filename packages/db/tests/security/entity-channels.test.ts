import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// E1 Channels and dial rules (docs/03-roadmap-appendix/phase2.md §5.2, migration 0161): a
// company's numbers are read by every principal acting in it and written by an Executive only,
// keep their company, channel and digits, and are never put back once out of use; a phone's DND
// state is the platform's record (`crm.dnd.record`), never a person's edit; and `app.dial_facts()`
// answers a person holding `calls.dial` about a lead they read, and nobody else. The role ×
// company read of `entity_channels` is in role-entity-matrix.test.ts. The suites never clean these
// tables, so every row here is found by this run's own ids.

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

/** Synthetic DLT numbers: ten digits starting 140 and 160, never a real line. */
const PROMO = '+911400000101';
const SERVICE = '+911600000101';

const workers = (entityId: number): Principal => ({
  ...principalFor('system:workers', [entityId]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

let fx: CrmFixture;
let exec1: Principal;
let exec2: Principal;
let accounts1: Principal;
const channels = { promo: newId(), service: newId(), old: newId() };

function lead(owner: keyof CrmFixture['leads']): string {
  const id = fx.leads[owner][0];
  if (!id) throw new Error(`fixture lead ${owner} missing`);
  return id;
}

/** The fixture's phone of a contact (`crmFixture` writes one per contact). */
async function phoneOf(owner: keyof CrmFixture['contacts']): Promise<{ id: string; e164: string }> {
  const contact = fx.contacts[owner][0] ?? '';
  const [row] = await asMigrator(
    (m) => m<{ id: string; e164: string }[]>`
      select id, e164 from contact_phones where contact_id = ${contact} order by id limit 1`,
  );
  if (!row) throw new Error(`fixture phone ${owner} missing`);
  return row;
}

beforeAll(async () => {
  fx = await crmFixture();
  exec1 = await createTestPrincipal('executive', [1]);
  exec2 = await createTestPrincipal('executive', [2]);
  accounts1 = await createTestPrincipal('accounts', [1]);
  await asMigrator(async (m) => {
    await m`update entity_channels set is_active = false
             where entity_id = 1 and channel in ('call_promo_140', 'call_service_160') and is_active`;
    await m`insert into entity_channels (id, entity_id, channel, number_e164, created_by) values
      (${channels.promo}, 1, 'call_promo_140', ${PROMO}, ${exec1.id}),
      (${channels.service}, 1, 'call_service_160', ${SERVICE}, ${exec1.id})`;
    await m`insert into entity_channels (id, entity_id, channel, number_e164, is_active, created_by)
      values (${channels.old}, 1, 'ivr', '+911800000101', false, ${exec1.id})`;
  });
});

describe('entity_channels', () => {
  it('is read by every principal acting in the company, and by no one outside it', async () => {
    const mine = sql`select id from entity_channels where id = any(${`{${Object.values(channels).join(',')}}`}::uuid[])`;
    expect(await rows(fx.principals.a, mine)).toHaveLength(3);
    expect(await rows(principalFor('agent:triage', [1]), mine)).toHaveLength(3);
    expect(await rows(fx.principals.d, mine)).toHaveLength(0);
    expect(await rows(exec2, mine)).toHaveLength(0);
    expect(await withoutContext(mine)).toHaveLength(0);
  });

  it('is written by an Executive of the company only', async () => {
    const insert = (who: Principal, entity: number) =>
      rows(
        who,
        sql`insert into entity_channels (id, entity_id, channel, number_e164, is_active, created_by)
            values (${newId()}, ${entity}, 'missed_call', '+911800000102', false, ${who.id})`,
      );
    expect(await failure(insert(fx.principals.gm, 1))).toMatch(/row-level security/);
    expect(await failure(insert(fx.principals.a, 1))).toMatch(/row-level security/);
    expect(await failure(insert(exec2, 1))).toMatch(/row-level security/);
    expect(await insert(exec1, 1)).toEqual([]);

    const verify = (who: Principal) =>
      rows(
        who,
        sql`update entity_channels set verified_at = now() where id = ${channels.promo} returning id`,
      );
    expect(await verify(fx.principals.gm)).toEqual([]);
    expect(await verify(exec2)).toEqual([]);
    expect(await verify(exec1)).toHaveLength(1);
  });

  it('keeps a number its company, channel and digits, and never deletes it', async () => {
    for (const change of [
      sql`update entity_channels set number_e164 = '+911400000199' where id = ${channels.promo}`,
      sql`update entity_channels set channel = 'ivr' where id = ${channels.promo}`,
      sql`update entity_channels set entity_id = 2 where id = ${channels.promo}`,
      sql`delete from entity_channels where id = ${channels.promo}`,
    ]) {
      expect(await failure(rows(exec1, change))).toMatch(/permission denied/);
    }
  });

  it('never puts back a number taken out of use, and keeps one live number per channel', async () => {
    expect(
      await failure(
        rows(exec1, sql`update entity_channels set is_active = true where id = ${channels.old}`),
      ),
    ).toMatch(/not put back/);
    expect(
      await failure(
        rows(
          exec1,
          sql`insert into entity_channels (id, entity_id, channel, number_e164, created_by)
              values (${newId()}, 1, 'call_promo_140', '+911400000102', ${exec1.id})`,
        ),
      ),
    ).toMatch(/entity_channels_active_unique/);
  });
});

describe("a phone's DND state", () => {
  it('is never set by a person, on a new phone or an existing one', async () => {
    const phone = await phoneOf('a');
    for (const change of [
      sql`update contact_phones set is_dnd = true where id = ${phone.id}`,
      sql`update contact_phones set dnd_checked_at = now() where id = ${phone.id}`,
    ]) {
      expect(await failure(rows(fx.principals.a, change))).toMatch(/recorded by the platform/);
    }
    expect(
      await failure(
        rows(
          fx.principals.a,
          sql`insert into contact_phones (id, contact_id, e164, dnd_checked_at, created_by)
              values (${newId()}, ${fx.contacts.a[0] ?? ''}, '+919800019999', now(), ${fx.principals.a.id})`,
        ),
      ),
    ).toMatch(/recorded by the platform/);
  });

  it('is recorded by the platform alone, for the number asked about, never older over newer', async () => {
    const phone = await phoneOf('a');
    const elsewhere = await phoneOf('b');
    const recordFor = (
      who: Principal,
      target: { id: string },
      e164: string,
      onDnd: boolean,
      at: string,
    ) =>
      rows<{ is_dnd: boolean; dnd_checked_at: Date }>(
        who,
        sql`select * from app.record_phone_dnd(${target.id}::uuid, ${e164}, ${onDnd}, ${at}::timestamptz)`,
      );
    const record = (who: Principal, e164: string, onDnd: boolean, at: string) =>
      recordFor(who, phone, e164, onDnd, at);
    for (const person of [exec1, fx.principals.a, fx.principals.gm]) {
      expect(await failure(record(person, phone.e164, true, new Date().toISOString()))).toMatch(
        /crm.dnd.record is required/,
      );
    }
    // A customer only company 1 knows, asked about for company 2, and another number, change
    // nothing.
    expect(
      await recordFor(workers(2), elsewhere, elsewhere.e164, true, new Date().toISOString()),
    ).toEqual([]);
    expect(await record(workers(1), '+919800019998', true, new Date().toISOString())).toEqual([]);
    expect(await failure(record(workers(1), phone.e164, true, '2099-01-01T00:00:00Z'))).toMatch(
      /not in the future/,
    );

    const now = new Date();
    const [newer] = await record(workers(1), phone.e164, true, now.toISOString());
    expect(newer?.is_dnd).toBe(true);
    const older = new Date(now.getTime() - 60_000).toISOString();
    const [kept] = await record(workers(1), phone.e164, false, older);
    expect(kept).toMatchObject({ is_dnd: true });
    expect(new Date(kept?.dnd_checked_at ?? 0).getTime()).toBe(now.getTime());
    // Put back for the other suites that read the fixture's phone.
    await asMigrator(
      (m) =>
        m`update contact_phones set is_dnd = false, dnd_checked_at = null where id = ${phone.id}`,
    );
  });
});

describe('app.dial_facts()', () => {
  const facts = (who: Principal, opportunity: string, phone: string) =>
    rows<{
      entity_id: number;
      phone_e164: string;
      promo_number: string | null;
      service_number: string | null;
      has_service_consent: boolean;
      call_consent_withdrawn: boolean;
    }>(who, sql`select * from app.dial_facts(${opportunity}::uuid, ${phone}::uuid)`);

  it('answers the caller who reads the lead, with the company numbers in use', async () => {
    const phone = await phoneOf('a');
    const [row] = await facts(fx.principals.a, lead('a'), phone.id);
    expect(row).toMatchObject({
      entity_id: 1,
      phone_e164: phone.e164,
      promo_number: PROMO,
      service_number: SERVICE,
      has_service_consent: false,
      call_consent_withdrawn: false,
    });
    // The team lead reads the team's leads.
    expect(await facts(fx.principals.l, lead('a'), phone.id)).toHaveLength(1);
  });

  it('answers nothing for a lead the caller does not read, or a phone of another customer', async () => {
    const phone = await phoneOf('a');
    expect(await facts(fx.principals.b, lead('a'), phone.id)).toEqual([]);
    expect(await facts(fx.principals.d, lead('a'), phone.id)).toEqual([]);
    expect(await facts(fx.principals.a, lead('a'), (await phoneOf('b')).id)).toEqual([]);
  });

  it('refuses anyone who is not a person holding calls.dial', async () => {
    const phone = await phoneOf('a');
    for (const who of [accounts1, workers(1), principalFor('agent:triage', [1])]) {
      expect(await failure(facts(who, lead('a'), phone.id))).toMatch(
        /a person holding calls.dial is required/,
      );
    }
  });
});
