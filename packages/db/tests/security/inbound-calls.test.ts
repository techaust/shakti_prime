import {
  newId,
  serializeGrants,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type postgres from 'postgres';
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

type Definer = 'lines' | 'bySid' | 'customers' | 'answerer' | 'ivr' | 'missed' | 'signal';

/** Every definer of the slice, called with valid arguments for company 1. */
function definers(): Record<Definer, SQL> {
  return {
    lines: sql`select * from app.inbound_call_lines('+918047119499')`,
    bySid: sql`select * from app.inbound_call_by_sid(${sid()})`,
    customers: sql`select * from app.inbound_call_customers(1::smallint, ${phoneA.e164})`,
    answerer: sql`select * from app.inbound_call_answerer(1::smallint, '+919800000999')`,
    ivr: sql`select * from app.record_inbound_call(1::smallint, ${newId()}::uuid, ${sid()}, null, now())`,
    missed: sql`select * from app.record_missed_call(1::smallint, ${newId()}::uuid, ${sid()},
                  ${leadOf('a')}::uuid, null, now(), ${IN_HOURS})`,
    signal: sql`select app.signal_ringing(1::smallint, ${fx.principals.a.id}::uuid, ${newId()}::uuid)`,
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
    for (const name of ['customers', 'answerer', 'ivr', 'missed', 'signal'] as const) {
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
                             'inbound_call_answerer', 'record_inbound_call', 'record_missed_call',
                             'signal_ringing')
           and r.rolname in ('app_user', 'app_reader', 'readonly_reporter', 'auth_service',
                             'outbox_publisher', 'webhook_receiver', 'public')
           and has_function_privilege(r.oid, p.oid, 'execute')
         order by 1, 2`,
    );
    expect(new Set(granted.map((g) => g.role))).toEqual(new Set(['app_user']));
    expect(granted).toHaveLength(7);
    // The wake-up's sender is the owner's alone: app_user reaches it only through the definer.
    const sender = await asMigrator(
      (m) => m<{ role: string }[]>`
        select r.rolname as role from pg_roles r
         where r.rolname in ('app_user', 'app_reader', 'readonly_reporter', 'auth_service',
                             'outbox_publisher', 'webhook_receiver', 'public')
           and has_function_privilege(r.oid,
                 'app.ringing_wake(regprocedure,regclass,smallint,uuid,uuid)', 'execute')`,
    );
    expect(sender).toEqual([]);
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

describe("one person per dial phone in a company (the IVR's answerer)", () => {
  it('refuses a second holder of a phone in the company, and lets another company use it', async () => {
    const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const [first, second] = [
      await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]),
      await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]),
    ];
    const profile = (userId: string, entityId: number) =>
      asMigrator(
        (m) => m`insert into caller_profiles (id, user_id, entity_id, dial_phone_e164)
                   values (${newId()}, ${userId}, ${entityId}, ${phone})`,
      );
    await profile(first.id, 1);
    await expect(profile(second.id, 1)).rejects.toThrow(/caller_profiles_entity_dial_phone_unique/);
    await profile(second.id, 2);
    expect(
      await rows(workers(1), sql`select * from app.inbound_call_answerer(1::smallint, ${phone})`),
    ).toEqual([{ user_id: first.id, holders: 1 }]);
  });

  it('answers how many hold a phone when two do, and rings neither', async () => {
    // Only a bypass of the unique index makes two holders, so it is dropped in a rolled-back
    // transaction, where the platform's request is set as withRequestContext() sets it.
    const phone = `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const people = [
      await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]),
      await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]),
    ];
    const platform = workers(1);
    const ROLLBACK = new Error('rolled back');
    let answer: unknown;
    await expect(
      asMigrator((m) =>
        m.begin(async (tx: postgres.TransactionSql) => {
          await tx`drop index caller_profiles_entity_dial_phone_unique`;
          for (const person of people) {
            await tx`insert into caller_profiles (id, user_id, entity_id, dial_phone_e164)
                       values (${newId()}, ${person.id}, 1, ${phone})`;
          }
          await tx`select set_config('app.user_id', ${platform.id}, true),
                          set_config('app.entity_ids', '{1}', true),
                          set_config('app.role', ${platform.roleKey}, true),
                          set_config('app.permissions', ${serializeGrants(platform.permissions)}, true)`;
          answer = await tx`select * from app.inbound_call_answerer(1::smallint, ${phone})`;
          throw ROLLBACK;
        }),
      ),
    ).rejects.toBe(ROLLBACK);
    expect(answer).toEqual([{ user_id: null, holders: 2 }]);
  });
});

/** The stand-in of Supabase's Realtime: its messages table and realtime.send(), as Supabase has them. */
const STAND_IN = 't4_realtime_stand_in';
const SEND = `${STAND_IN}.send(jsonb,text,text,boolean)`;
const MESSAGES = `${STAND_IN}.messages`;

async function standInRealtime(): Promise<void> {
  await asMigrator(async (m) => {
    await m.unsafe(`drop schema if exists ${STAND_IN} cascade`);
    await m.unsafe(`create schema ${STAND_IN}`);
    await m.unsafe(`create table ${MESSAGES} (
      topic text not null, extension text not null, payload jsonb, event text,
      private boolean default false, updated_at timestamp default now() not null,
      inserted_at timestamp default now() not null, id uuid default gen_random_uuid() not null)`);
    // Supabase's body: the failure is swallowed into a warning, and nothing tells the caller.
    await m.unsafe(`create function ${STAND_IN}.send(payload jsonb, event text, topic text,
                                                     private boolean default true)
      returns void language plpgsql as $$
      declare generated_id uuid; final_payload jsonb;
      begin
        begin
          generated_id := gen_random_uuid();
          if payload ? 'id' then final_payload := payload;
          else final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
          end if;
          execute format('SET LOCAL realtime.topic TO %L', topic);
          insert into ${MESSAGES} (id, payload, event, topic, private, extension)
            values (generated_id, final_payload, event, topic, private, 'broadcast');
        exception when others then
          raise warning 'ErrorSendingBroadcastMessage: %', sqlerrm;
        end;
      end $$`);
  });
}

describe('the Realtime wake-up of a ringing call (app.signal_ringing)', () => {
  let person: { id: string };
  let call: string;

  beforeAll(async () => {
    person = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    call = newId();
    await rows(
      workers(1),
      sql`select * from app.record_inbound_call(1::smallint, ${call}::uuid, ${sid()}, ${person.id}::uuid, now())`,
    );
    await standInRealtime();
  });

  afterAll(async () => {
    await asMigrator((m) => m.unsafe(`drop schema if exists ${STAND_IN} cascade`));
  });

  const signal = (userId: string, callId: string) =>
    sql`select app.signal_ringing(1::smallint, ${userId}::uuid, ${callId}::uuid) as outcome`;

  it('sends nothing where the database has no Realtime; refuses a person of no company and a call not theirs', async () => {
    // The local image has the realtime schema but not Supabase's realtime.send().
    expect(await rows(workers(1), signal(person.id, call))).toEqual([{ outcome: 'unavailable' }]);
    const outsider = await createTestUser([{ entityId: 2, roleKey: 'tele_caller_cc' }]);
    expect(await failure(rows(workers(1), signal(outsider.id, call)))).toBe(
      'the person rung works in the company',
    );
    const colleague = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    expect(await failure(rows(workers(1), signal(colleague.id, call)))).toBe(
      'the call rings the person',
    );
    expect(await failure(rows(workers(1), signal(person.id, newId())))).toBe(
      'the call rings the person',
    );
  });

  it('is a write: refused inside a read-only transaction, where the message could not be written', async () => {
    const refused = await failure(
      asPrincipal(workers(1), async ({ tx }) => {
        await tx.execute(sql`select set_config('transaction_read_only', 'on', true)`);
        return tx.execute(signal(person.id, call));
      }),
    );
    expect(refused).toBe('the wake-up is written by a command, never a read');
  });

  async function wake(m: postgres.Sql | postgres.TransactionSql, userId: string, callId: string) {
    const [row] = await m<{ outcome: string }[]>`
      select app.ringing_wake(${SEND}::regprocedure, ${MESSAGES}::regclass, 1::smallint,
                              ${userId}::uuid, ${callId}::uuid) as outcome`;
    return row?.outcome;
  }

  async function messages(userId: string) {
    return asMigrator(
      (m) => m<
        { topic: string; event: string; private: boolean; payload: Record<string, unknown> }[]
      >`
        select topic, event, private, payload from ${m(STAND_IN)}.messages
         where topic = ${`user:${userId}`}`,
    );
  }

  it('writes one private message on the person’s own channel, with the call’s ids only', async () => {
    await asMigrator(async (m) => {
      expect(await wake(m, person.id, call)).toBe('sent');
    });
    const written = await messages(person.id);
    expect(written).toHaveLength(1);
    const [message] = written;
    expect(message).toMatchObject({ topic: `user:${person.id}`, event: 'ringing', private: true });
    // realtime.send() adds the message's own id; nothing else rides with the call's ids.
    expect(Object.keys(message?.payload ?? {}).sort()).toEqual([
      'entityId',
      'id',
      'providerCallId',
    ]);
    expect(message?.payload).toMatchObject({ providerCallId: call, entityId: 1 });
    expect(typeof message?.payload.id).toBe('string');
  });

  it('answers failed when realtime.send() swallows its failure, as it does in a read-only transaction', async () => {
    const other = newId();
    const ROLLBACK = new Error('rolled back');
    let outcome: string | undefined;
    await expect(
      asMigrator((m) =>
        m.begin(async (tx: postgres.TransactionSql) => {
          await tx`select set_config('transaction_read_only', 'on', true)`;
          outcome = await wake(tx, person.id, other);
          throw ROLLBACK;
        }),
      ),
    ).rejects.toBe(ROLLBACK);
    expect(outcome).toBe('failed');
    // And when Realtime refuses the message itself.
    await asMigrator((m) =>
      m.unsafe(
        `alter table ${MESSAGES} add constraint refused check (event <> 'ringing') not valid`,
      ),
    );
    try {
      await asMigrator(async (m) => {
        expect(await wake(m, person.id, other)).toBe('failed');
      });
    } finally {
      await asMigrator((m) => m.unsafe(`alter table ${MESSAGES} drop constraint refused`));
    }
    expect((await messages(person.id)).filter((m) => m.payload.providerCallId === other)).toEqual(
      [],
    );
  });
});
