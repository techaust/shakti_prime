import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestUser,
  principalFor,
  whatsappCustomer,
} from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// T4 Inbound calls (docs/03-roadmap-appendix/phase2.md §7.4, migrations 0189 and 0190): the
// platform records a customer's call to a company's IVR or missed-call line only through definers
// that check the platform-only calls.process and the request's company, so no person, agent or
// reader reaches them, and the platform reads customers only through them, never through a
// person's grant (ADR 0020). An IVR call has no lead and is read by nobody; a missed call is read
// with its lead. The suites never clean these tables, so every row here is found by this run's ids.

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

const sid = (): string => `t4s${newId().replaceAll('-', '')}`;
/** 11:00 IST yesterday, inside calling hours. */
const IN_HOURS = sql`(date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '13 hours') at time zone 'Asia/Kolkata'`;

let fx: CrmFixture;
let exec: Principal;
let phoneA: { id: string; e164: string };

function leadOf(owner: keyof CrmFixture['leads']): string {
  const id = fx.leads[owner][0];
  if (!id) throw new Error(`fixture lead ${owner} missing`);
  return id;
}

/** Every definer of the slice, called with valid arguments for company 1. */
function definers(): Record<string, SQL> {
  return {
    lines: sql`select * from app.inbound_call_lines('+918047119499')`,
    bySid: sql`select * from app.inbound_call_by_sid(${sid()})`,
    customers: sql`select * from app.inbound_call_customers(1::smallint, ${phoneA.e164})`,
    answerer: sql`select app.inbound_call_answerer(1::smallint, '+919800000999')`,
    ivr: sql`select * from app.record_inbound_call(1::smallint, ${newId()}::uuid, ${sid()}, null, now())`,
    missed: sql`select * from app.record_missed_call(1::smallint, ${newId()}::uuid, ${sid()},
                  ${leadOf('a')}::uuid, null, now(), ${IN_HOURS})`,
  };
}

beforeAll(async () => {
  fx = await crmFixture();
  exec = principalFor('executive', [1]);
  const contact = fx.contacts.a[0] ?? '';
  const [row] = await asMigrator(
    (m) => m<{ id: string; e164: string }[]>`
      select id, e164 from contact_phones where contact_id = ${contact} limit 1`,
  );
  if (!row) throw new Error('fixture phone missing');
  phoneA = row;
});

describe('the inbound call definers', () => {
  it('refuse every person, an Executive included, and every agent: calls.process is the platform’s', async () => {
    const people = [fx.principals.a, fx.principals.gm, fx.principals.l, exec];
    const agents = [principalFor('agent:copilot', [1]), principalFor('agent:concierge', [1])];
    for (const who of [...people, ...agents]) {
      for (const [name, query] of Object.entries(definers())) {
        expect({ who: who.roleKey, name, error: await failure(rows(who, query)) }).toEqual({
          who: who.roleKey,
          name,
          error: 'calls.process is required',
        });
      }
    }
  });

  it('refuse the platform a company outside its request', async () => {
    for (const name of ['customers', 'answerer', 'ivr', 'missed'] as const) {
      expect(await failure(rows(workers(2), definers()[name]))).toBe(
        'the company is outside the request',
      );
    }
  });

  it('are executed by app_user alone: no reader, reporter or other role', async () => {
    const granted = await asMigrator(
      (m) => m<{ fn: string; role: string }[]>`
        select p.proname as fn, r.rolname as role
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'app'
          cross join pg_roles r
         where p.proname in ('inbound_call_lines', 'inbound_call_by_sid', 'inbound_call_customers',
                             'inbound_call_answerer', 'record_inbound_call', 'record_missed_call')
           and r.rolname in ('app_user', 'app_reader', 'readonly_reporter', 'auth_service',
                             'outbox_publisher', 'webhook_receiver', 'public')
           and has_function_privilege(r.oid, p.oid, 'execute')
         order by 1, 2`,
    );
    expect(new Set(granted.map((g) => g.role))).toEqual(new Set(['app_user']));
    expect(granted).toHaveLength(6);
  });
});

describe('the platform reads customers only through the definers (ADR 0020)', () => {
  it('reads no customer, phone or lead directly, and matches them through calls.process', async () => {
    const platform = workers(1);
    expect(await rows(platform, sql`select id from accounts`)).toEqual([]);
    expect(await rows(platform, sql`select id from contact_phones`)).toEqual([]);
    expect(await rows(platform, sql`select id from opportunities`)).toEqual([]);
    const matched = await rows<{ account_id: string }>(platform, definers().customers);
    expect(matched.map((m) => m.account_id)).toContain(fx.accounts.a[0]);
  });

  it('never matches a customer of another company', async () => {
    const ours = await whatsappCustomer(1);
    const match = (entity: number) =>
      rows<{ account_id: string }>(
        workers(entity),
        sql`select * from app.inbound_call_customers(${entity}::smallint, ${ours.e164})`,
      );
    expect((await match(1)).map((m) => m.account_id)).toEqual([ours.accountId]);
    expect(await match(2)).toEqual([]);
  });
});

describe('provider_calls for inbound calls', () => {
  it('records an IVR call that nobody reads, and a repeat writes nothing', async () => {
    const id = newId();
    const callSid = sid();
    const person = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const record = sql`select outcome, provider_call_id
                         from app.record_inbound_call(1::smallint, ${id}::uuid, ${callSid},
                                                      ${person.id}::uuid, now())`;
    expect(await rows(workers(1), record)).toEqual([{ outcome: 'recorded', provider_call_id: id }]);
    const again = sql`select outcome, provider_call_id
                        from app.record_inbound_call(1::smallint, ${newId()}::uuid, ${callSid},
                                                     null, now())`;
    expect(await rows(workers(1), again)).toEqual([{ outcome: 'repeat', provider_call_id: id }]);
    const read = sql`select id from provider_calls where id = ${id}`;
    for (const who of [fx.principals.a, fx.principals.gm, exec, workers(1)]) {
      expect(await rows(who, read)).toEqual([]);
    }
  });

  it('refuses a person rung who does not work in the company', async () => {
    const elsewhere = await createTestUser([{ entityId: 2, roleKey: 'tele_caller_cc' }]);
    expect(
      await failure(
        rows(
          workers(1),
          sql`select * from app.record_inbound_call(1::smallint, ${newId()}::uuid, ${sid()},
                                                   ${elsewhere.id}::uuid, now())`,
        ),
      ),
    ).toBe('the person rung works in the company');
  });

  it('records a missed call read with its lead, and its callback only inside calling hours', async () => {
    const id = newId();
    const record = (due: SQL, phone: string | null = phoneA.id) =>
      sql`select outcome, provider_call_id, owner_id
            from app.record_missed_call(1::smallint, ${id}::uuid, ${sid()}, ${leadOf('a')}::uuid,
                                        ${phone}::uuid, now(), ${due})`;
    const late = sql`(${IN_HOURS}) + interval '11 hours'`;
    expect(await failure(rows(workers(1), record(late)))).toBe('a callback falls in calling hours');
    const [b] = fx.contacts.b;
    const [other] = await asMigrator(
      (m) =>
        m<{ id: string }[]>`select id from contact_phones where contact_id = ${b ?? ''} limit 1`,
    );
    expect(await failure(rows(workers(1), record(IN_HOURS, other?.id ?? null)))).toBe(
      "the phone is the lead's customer's",
    );
    expect(await rows(workers(1), record(IN_HOURS))).toEqual([
      { outcome: 'recorded', provider_call_id: id, owner_id: fx.principals.a.id },
    ]);
    const read = sql`select series, direction from provider_calls where id = ${id}`;
    expect(await rows(fx.principals.a, read)).toEqual([
      { series: 'missed_call', direction: 'inbound' },
    ]);
    expect(await rows(fx.principals.d, read)).toEqual([]);
  });

  it('refuses a missed call on another company’s lead', async () => {
    expect(
      await failure(
        rows(
          workers(1),
          sql`select * from app.record_missed_call(1::smallint, ${newId()}::uuid, ${sid()},
                                                  ${leadOf('d')}::uuid, null, now(), ${IN_HOURS})`,
        ),
      ),
    ).toBe('the lead is not of the company');
  });

  it('lets no person insert an inbound call', async () => {
    expect(
      await failure(
        rows(
          fx.principals.a,
          sql`insert into provider_calls (id, entity_id, opportunity_id, caller_id, direction,
                                          series, status, started_at)
              values (${newId()}, 1, ${leadOf('a')}, ${fx.principals.a.id}, 'inbound', 'ivr',
                      'dialling', now())`,
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('holds a dial to its lead, an inbound call to its lines, and a missed call to a lead', async () => {
    const insert = (
      direction: string,
      series: string,
      purpose: string | null,
      lead: string | null,
    ) =>
      asMigrator(
        (m) => m`insert into provider_calls (id, entity_id, opportunity_id, caller_id, direction,
                                             series, purpose, status, started_at)
                 values (${newId()}, 1, ${lead}, ${fx.principals.a.id}, ${direction}, ${series},
                         ${purpose}, 'ringing', now())`,
      );
    await expect(insert('outbound', '140', 'promotional', null)).rejects.toThrow(
      /provider_calls_outbound_lead_check/,
    );
    await expect(insert('inbound', '160', null, null)).rejects.toThrow(
      /provider_calls_inbound_check/,
    );
    await expect(insert('inbound', 'ivr', 'service', null)).rejects.toThrow(
      /provider_calls_inbound_check/,
    );
    await expect(insert('inbound', 'missed_call', null, null)).rejects.toThrow(
      /provider_calls_inbound_check/,
    );
  });
});
