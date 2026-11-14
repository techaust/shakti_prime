import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  PLATFORM_TABLES,
  principalFor,
  whatsappChannel,
  whatsappCustomer,
  withoutContext,
  type WhatsAppChannelFixture,
  type WhatsAppCustomerFixture,
} from '../../src/testing/index';

// W1 WhatsApp threads and messaging (docs/03-roadmap-appendix/phase2.md §6.1, migrations 0168 and
// 0169): threads and messages are read under the customer's read rule and written by the platform's
// definers (`messaging.process`), a person queues a message on a thread they may message, a status
// only moves forward, a message keeps what it was written with, a number that opted out gets
// nothing but the one confirmation of its STOP, Meta's ids are kept where no request reads them,
// and templates change their status only through the platform. The role × company read of the
// three tables is in role-entity-matrix.test.ts. The suites never clean these tables, so every row
// here is found by this run's own ids and numbers.

afterAll(closeDb);

type Migrator = postgres.Sql;

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

const workers = (entityIds: number[]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

interface Inbound {
  entity_id: number;
  thread_id: string;
  message_id: string;
  duplicate: boolean;
  first_message: boolean;
  account_id: string | null;
  opportunity_id: string | null;
  holders: number;
  opted_out: boolean;
  handled_by: string;
}

let channel1: WhatsAppChannelFixture;
let exec1: Principal;
let gm1: Principal;
let otherCaller: Principal;

/** An inbound text from `waId` to company 1's number, as the platform records it. */
function inbound(
  waId: string,
  options: { id?: string; at?: string; who?: Principal; phoneNumberId?: string } = {},
) {
  return rows<Inbound>(
    options.who ?? workers([1]),
    sql`select * from app.whatsapp_record_inbound(
          ${options.phoneNumberId ?? channel1.phoneNumberId}, ${waId},
          ${options.id ?? `wamid.${newId()}`}, 'text', 'hello', null,
          ${options.at ?? new Date().toISOString()}::timestamptz)`,
  );
}

/** The thread of a customer, opened by an inbound message. */
async function openThread(customer: WhatsAppCustomerFixture): Promise<Inbound> {
  const [row] = await inbound(customer.waId);
  if (!row) throw new Error('no thread opened');
  return row;
}

/** A template queued by the platform on a thread, taken and sent: Meta's id for its statuses. */
async function sentMessage(threadId: string): Promise<{ messageId: string; wamid: string }> {
  const [queued] = await rows<{ message_id: string }>(
    workers([1]),
    sql`select * from app.whatsapp_queue_message(${threadId}::uuid, 'template', 'hello_world', '[]'::jsonb)`,
  );
  const messageId = queued?.message_id ?? '';
  const [claimed] = await rows<{ claimed: boolean }>(
    workers([1]),
    sql`select app.whatsapp_claim_send(${messageId}::uuid) as claimed`,
  );
  expect(claimed?.claimed).toBe(true);
  const wamid = `wamid.${newId()}`;
  await rows(
    workers([1]),
    sql`select * from app.whatsapp_record_send(${messageId}::uuid, 'sent', ${wamid}, null, null)`,
  );
  return { messageId, wamid };
}

beforeAll(async () => {
  channel1 = await whatsappChannel(1);
  await whatsappChannel(2);
  exec1 = await createTestPrincipal('executive', [1]);
  gm1 = await createTestPrincipal('general_manager', [1]);
  otherCaller = await createTestPrincipal('tele_caller_cc', [1]);
});

describe('the WhatsApp tables', () => {
  it('keep Meta message ids where no request role reads or writes them', async () => {
    expect(PLATFORM_TABLES).toContain('whatsapp_message_keys');
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'whatsapp_message_keys', 'SELECT') as app_select,
             has_table_privilege('app_user', 'whatsapp_message_keys', 'INSERT') as app_insert,
             has_table_privilege('app_reader', 'whatsapp_message_keys', 'SELECT') as reader,
             has_table_privilege('readonly_reporter', 'whatsapp_message_keys', 'SELECT') as reporter`);
    expect(grants).toEqual({ app_select: false, app_insert: false, reader: false, reporter: false });
    expect(
      await failure(rows(exec1, sql`select count(*) from whatsapp_message_keys`)),
    ).toMatch(/permission denied/);
  });

  it('keep the monthly message partitions in a schema no request role may use, made each month', async () => {
    const [usage] = await withoutContext<Record<string, boolean>>(sql`
      select has_schema_privilege('app_user', 'messaging_partitions', 'USAGE') as app,
             has_schema_privilege('app_reader', 'messaging_partitions', 'USAGE') as reader,
             has_function_privilege('app_user', 'app.ensure_whatsapp_message_partitions(int)', 'EXECUTE') as make`);
    expect(usage).toEqual({ app: false, reader: false, make: false });
    const month = new Date().toISOString().slice(0, 7).replace('-', '_');
    const parts = await asMigrator(
      (m) => m<{ name: string }[]>`
        select c.relname as name from pg_inherits i
          join pg_class c on c.oid = i.inhrelid
          join pg_namespace n on n.oid = c.relnamespace
         where i.inhparent = 'public.whatsapp_messages'::regclass and n.nspname = 'messaging_partitions'`,
    );
    expect(parts.map((p) => p.name)).toEqual(
      expect.arrayContaining(['whatsapp_messages_default', `whatsapp_messages_${month}`]),
    );
    const [job] = await asMigrator(
      (m) => m<{ schedule: string; command: string }[]>`
        select schedule, command from cron.job where jobname = 'whatsapp-messages-partitions'`,
    );
    expect(job?.schedule).toBe('15 3 25 * *');
    expect(job?.command).toMatch(/statement_timeout.*app\.ensure_whatsapp_message_partitions\(3\)/);
    await asMigrator((m) => m`select app.ensure_whatsapp_message_partitions(3)`);
    const [run] = await asMigrator(
      (m) => m<{ error: string | null; finished: boolean }[]>`
        select error, finished_at is not null as finished from retention_runs
         where job = 'whatsapp-messages-partitions' order by started_at desc limit 1`,
    );
    expect(run).toEqual({ error: null, finished: true });
  });
});

describe('an inbound message (app.whatsapp_record_inbound)', () => {
  it('is recorded only by the platform', async () => {
    const customer = await whatsappCustomer(1);
    for (const who of [exec1, gm1, customer.owner, principalFor('agent:concierge', [1])]) {
      expect(await failure(inbound(customer.waId, { who }))).toMatch(
        /messaging.process is required/,
      );
    }
  });

  it('opens the thread of the one customer holding the number, with its lead, owner and window', async () => {
    const customer = await whatsappCustomer(1);
    const at = new Date(Date.now() - 60_000).toISOString();
    const [row] = await inbound(customer.waId, { at });
    expect(row).toMatchObject({
      entity_id: 1,
      duplicate: false,
      first_message: true,
      account_id: customer.accountId,
      opportunity_id: customer.opportunityId,
      holders: 1,
      opted_out: false,
      handled_by: 'assistant',
    });
    const [thread] = await asMigrator(
      (m) => m<{
        contact_phone_id: string;
        assignee_id: string;
        window_open_until: Date;
        needs_reply: boolean;
        last_inbound_at: Date;
      }[]>`select contact_phone_id, assignee_id, window_open_until, needs_reply, last_inbound_at
             from whatsapp_threads where id = ${row?.thread_id ?? ''}`,
    );
    expect(thread).toMatchObject({
      contact_phone_id: customer.phoneId,
      assignee_id: customer.owner.id,
      needs_reply: true,
    });
    expect(new Date(thread?.window_open_until ?? 0).getTime()).toBe(
      new Date(at).getTime() + 24 * 3600 * 1000,
    );
    // The owner reads it; a caller of another team does not, nor anyone of company 2.
    const read = sql`select id from whatsapp_threads where id = ${row?.thread_id ?? ''}`;
    expect(await rows(customer.owner, read)).toHaveLength(1);
    expect(await rows(otherCaller, read)).toHaveLength(0);
    expect(await rows(await createTestPrincipal('general_manager', [2]), read)).toHaveLength(0);
  });

  it('stores a repeated message once and changes nothing, and a second message on the same thread', async () => {
    const customer = await whatsappCustomer(1);
    const id = `wamid.${newId()}`;
    const [first] = await inbound(customer.waId, { id });
    const [again] = await inbound(customer.waId, { id });
    expect(again).toMatchObject({
      duplicate: true,
      first_message: false,
      thread_id: first?.thread_id,
      message_id: first?.message_id,
    });
    const [next] = await inbound(customer.waId);
    expect(next).toMatchObject({ duplicate: false, first_message: false, thread_id: first?.thread_id });
    const [count] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from whatsapp_messages
                                 where thread_id = ${first?.thread_id ?? ''}`,
    );
    expect(count?.n).toBe(2);
  });

  it('keeps the newest message time when an older one arrives late', async () => {
    const customer = await whatsappCustomer(1);
    const now = Date.now();
    const [first] = await inbound(customer.waId, { at: new Date(now - 1000).toISOString() });
    await inbound(customer.waId, { at: new Date(now - 3_600_000).toISOString() });
    const [thread] = await asMigrator(
      (m) => m<{ last: Date; until: Date }[]>`
        select last_inbound_at as last, window_open_until as until from whatsapp_threads
         where id = ${first?.thread_id ?? ''}`,
    );
    expect(new Date(thread?.last ?? 0).getTime()).toBe(now - 1000);
    expect(new Date(thread?.until ?? 0).getTime()).toBe(now - 1000 + 24 * 3600 * 1000);
  });

  it('leaves a number several customers hold unmatched, read only with messaging.send for the company', async () => {
    const one = await whatsappCustomer(1);
    const two = await whatsappCustomer(1, { e164: one.e164 });
    const [row] = await inbound(one.waId);
    expect(row).toMatchObject({ account_id: null, opportunity_id: null, holders: 2 });
    const read = sql`select id from whatsapp_threads where id = ${row?.thread_id ?? ''}`;
    expect(await rows(one.owner, read)).toHaveLength(0);
    expect(await rows(two.owner, read)).toHaveLength(0);
    expect(await rows(gm1, read)).toHaveLength(1);
    // The platform matches it to one of the holders, never to a customer who does not hold it.
    const stranger = await whatsappCustomer(1);
    expect(
      await failure(
        rows(
          workers([1]),
          sql`select * from app.whatsapp_match_thread(${row?.thread_id ?? ''}::uuid, ${stranger.accountId}::uuid)`,
        ),
      ),
    ).toMatch(/does not hold/);
    const [matched] = await rows<{ account_id: string; matched: boolean }>(
      workers([1]),
      sql`select * from app.whatsapp_match_thread(${row?.thread_id ?? ''}::uuid, ${two.accountId}::uuid)`,
    );
    expect(matched).toMatchObject({ account_id: two.accountId, matched: true });
    expect(await rows(two.owner, read)).toHaveLength(1);
    // A matched thread keeps its customer.
    const [kept] = await rows<{ account_id: string; matched: boolean }>(
      workers([1]),
      sql`select * from app.whatsapp_match_thread(${row?.thread_id ?? ''}::uuid, ${one.accountId}::uuid)`,
    );
    expect(kept).toMatchObject({ account_id: two.accountId, matched: false });
    expect(
      await failure(
        rows(
          exec1,
          sql`select * from app.whatsapp_match_thread(${row?.thread_id ?? ''}::uuid, ${one.accountId}::uuid)`,
        ),
      ),
    ).toMatch(/messaging.process is required/);
  });

  it('opens a thread for a number no customer holds yet, and finds no company for another number', async () => {
    const [row] = await inbound(`91${'6'.repeat(9)}${Math.floor(Math.random() * 10).toString()}`);
    expect(row).toMatchObject({ account_id: null, holders: 0 });
    expect(await inbound('919800000001', { phoneNumberId: 'no-such-number' })).toEqual([]);
    // Company 1's number for a request of company 2 alone is no company's.
    expect(await inbound('919800000001', { who: workers([2]) })).toEqual([]);
  });
});

describe('a message status', () => {
  it('only moves forward, so a repeated or late status changes nothing', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const { messageId, wamid } = await sentMessage(thread.thread_id);
    const status = (s: string) =>
      rows<{ status: string; changed: boolean }>(
        workers([1]),
        sql`select status, changed from app.whatsapp_record_status(${wamid}, ${s}, now(), null)`,
      );
    expect((await status('read'))[0]).toEqual({ status: 'read', changed: true });
    expect((await status('delivered'))[0]).toEqual({ status: 'read', changed: false });
    expect((await status('sent'))[0]).toEqual({ status: 'read', changed: false });
    expect((await status('failed'))[0]).toEqual({ status: 'read', changed: false });
    expect((await status('read'))[0]).toEqual({ status: 'read', changed: false });
    // An unknown id, or one of another company's request, is no message.
    expect(
      await rows(workers([1]), sql`select * from app.whatsapp_record_status('wamid.none', 'read', now(), null)`),
    ).toEqual([]);
    expect(
      await rows(workers([2]), sql`select * from app.whatsapp_record_status(${wamid}, 'read', now(), null)`),
    ).toEqual([]);
    expect(
      await failure(
        rows(exec1, sql`select * from app.whatsapp_record_status(${wamid}, 'read', now(), null)`),
      ),
    ).toMatch(/messaging.process is required/);
    // The guard holds even for the table's owner.
    expect(
      await failure(
        asMigrator(
          (m) => m`update whatsapp_messages set status = 'delivered' where id = ${messageId}`,
        ),
      ),
    ).toMatch(/only moves forward/);
  });

  it('records a failure with Meta’s code from sent', async () => {
    const thread = await openThread(await whatsappCustomer(1));
    const { wamid } = await sentMessage(thread.thread_id);
    const [row] = await rows<{ status: string; changed: boolean }>(
      workers([1]),
      sql`select status, changed from app.whatsapp_record_status(${wamid}, 'failed', now(), 131026)`,
    );
    expect(row).toEqual({ status: 'failed', changed: true });
    const [stored] = await asMigrator(
      (m) => m<{ error_code: number }[]>`select error_code from whatsapp_messages
                                           where provider_message_id = ${wamid}`,
    );
    expect(stored?.error_code).toBe(131026);
  });
});

describe('a message keeps what it was written with', () => {
  it('refuses a change of its text, a second Meta id, and any removal, whoever asks', async () => {
    const thread = await openThread(await whatsappCustomer(1));
    const { messageId } = await sentMessage(thread.thread_id);
    const changes = [
      (m: Migrator) => m`update whatsapp_messages set body_masked = 'changed' where id = ${messageId}`,
      (m: Migrator) =>
        m`update whatsapp_messages set provider_message_id = 'wamid.other' where id = ${messageId}`,
      (m: Migrator) => m`update whatsapp_messages set sent_by = null where id = ${messageId}`,
    ];
    for (const change of changes) {
      expect(await failure(asMigrator(change))).toMatch(/keeps what it was written with/);
    }
    expect(
      await failure(asMigrator((m) => m`delete from whatsapp_messages where id = ${messageId}`)),
    ).toMatch(/append-only/);
    // No request role updates or deletes a message at all.
    expect(
      await failure(
        rows(exec1, sql`update whatsapp_messages set status = 'read' where id = ${messageId}`),
      ),
    ).toMatch(/permission denied/);
  });
});

describe('a person queues a message (whatsapp_messages_insert)', () => {
  const queue = (who: Principal, threadId: string, statusAt: string | null = null) =>
    rows(
      who,
      sql`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, body_masked, status, status_at, sent_by)
          values (${newId()}, 1, ${threadId}, 'outbound', 'text', 'Your visit is tomorrow', 'queued',
                  ${statusAt}::timestamptz, ${who.id})`,
    );

  it('on a thread they may message, as themselves, queued and nothing more', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    await queue(customer.owner, thread.thread_id);
    // A caller of another team may not, nor a principal claiming another sender.
    expect(await failure(queue(otherCaller, thread.thread_id))).toMatch(/row-level security/);
    expect(
      await failure(
        rows(
          customer.owner,
          sql`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, body_masked, status, sent_by)
              values (${newId()}, 1, ${thread.thread_id}, 'outbound', 'text', 'x', 'queued', ${otherCaller.id})`,
        ),
      ),
    ).toMatch(/row-level security/);
    // Never as sent, never with a status time, never inbound.
    expect(
      await failure(
        rows(
          customer.owner,
          sql`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, body_masked, status, sent_by)
              values (${newId()}, 1, ${thread.thread_id}, 'outbound', 'text', 'x', 'sent', ${customer.owner.id})`,
        ),
      ),
    ).toMatch(/row-level security|starts queued/);
    expect(await failure(queue(customer.owner, thread.thread_id, new Date().toISOString()))).toMatch(
      /row-level security/,
    );
    expect(
      await failure(
        rows(
          customer.owner,
          sql`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, provider_message_id, body_masked)
              values (${newId()}, 1, ${thread.thread_id}, 'inbound', 'text', ${`wamid.${newId()}`}, 'x')`,
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('changes only who answers the thread and whether it waits for a reply', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const update = (who: Principal, set: SQL) =>
      rows(
        who,
        sql`update whatsapp_threads set ${set} where id = ${thread.thread_id} returning id`,
      );
    expect(
      await update(customer.owner, sql`handled_by = 'people', handoff_reason = 'request', handed_off_at = now()`),
    ).toHaveLength(1);
    expect(await update(otherCaller, sql`needs_reply = false`)).toHaveLength(0);
    for (const set of [
      sql`window_open_until = now() + interval '1 day'`,
      sql`opted_out_at = null`,
      sql`account_id = null`,
    ]) {
      expect(await failure(update(customer.owner, set))).toMatch(/permission denied/);
    }
  });
});

describe('a number that opted out (app.whatsapp_record_opt_out)', () => {
  it('withdraws every WhatsApp consent of the number and gets only the one confirmation of its STOP', async () => {
    const customer = await whatsappCustomer(1);
    const other = await whatsappCustomer(1, { e164: `+91${customer.waId.slice(2)}` });
    const consents = [newId(), newId()];
    await asMigrator(
      (m) => m`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by) values
        (${consents[0] ?? ''}, ${customer.contactId}, 'whatsapp', 'service', 'whatsapp_opt_in', 'v1', now() - interval '1 day', ${customer.owner.id}),
        (${consents[1] ?? ''}, ${other.contactId}, 'whatsapp', 'promotional', 'whatsapp_opt_in', 'v1', now() - interval '1 day', ${other.owner.id})`,
    );
    const thread = await inbound(customer.waId).then((r) => r[0]);
    const threadId = thread?.thread_id ?? '';
    // Two customers hold the number: the thread is matched to the one who wrote.
    await rows(
      workers([1]),
      sql`select * from app.whatsapp_match_thread(${threadId}::uuid, ${customer.accountId}::uuid)`,
    );
    for (const who of [exec1, customer.owner]) {
      expect(
        await failure(
          rows(who, sql`select * from app.whatsapp_record_opt_out(${threadId}::uuid, now())`),
        ),
      ).toMatch(/messaging.process is required/);
    }
    const [stop] = await rows<{ newly: boolean; consents_withdrawn: number }>(
      workers([1]),
      sql`select * from app.whatsapp_record_opt_out(${threadId}::uuid, now())`,
    );
    expect(stop).toMatchObject({ newly: true, consents_withdrawn: 2 });
    const [again] = await rows<{ newly: boolean }>(
      workers([1]),
      sql`select * from app.whatsapp_record_opt_out(${threadId}::uuid, now())`,
    );
    expect(again?.newly).toBe(false);
    const timeline = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from activities
                                 where account_id = ${customer.accountId} and type = 'consent_withdrawn'`,
    );
    expect(timeline[0]?.n).toBe(1);
    const [opted] = await rows<{ opted: boolean }>(
      customer.owner,
      sql`select app.whatsapp_thread_opted_out(${threadId}::uuid) as opted`,
    );
    expect(opted?.opted).toBe(true);

    // Nothing more reaches the number: a person's message, the platform's welcome.
    expect(
      await failure(
        rows(
          customer.owner,
          sql`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, body_masked, status, sent_by)
              values (${newId()}, 1, ${threadId}, 'outbound', 'text', 'x', 'queued', ${customer.owner.id})`,
        ),
      ),
    ).toMatch(/opted out/);
    expect(
      await failure(
        rows(
          workers([1]),
          sql`select * from app.whatsapp_queue_message(${threadId}::uuid, 'template', 'welcome_note', '[]'::jsonb)`,
        ),
      ),
    ).toMatch(/opted out/);
    // The confirmation of the STOP goes once.
    const confirm = sql`select * from app.whatsapp_queue_message(${threadId}::uuid, 'system', 'stop_note', '[]'::jsonb)`;
    expect(await rows(workers([1]), confirm)).toHaveLength(1);
    expect(await failure(rows(workers([1]), confirm))).toMatch(/one confirmation/);
    // A WhatsApp consent given since lifts it.
    await asMigrator(
      (m) => m`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
        values (${newId()}, ${customer.contactId}, 'whatsapp', 'service', 'verbal', 'v1', now() + interval '1 second', ${customer.owner.id})`,
    );
    // The other holder's withdrawal still stands, so the number stays opted out.
    const [still] = await rows<{ opted: boolean }>(
      customer.owner,
      sql`select app.whatsapp_thread_opted_out(${threadId}::uuid) as opted`,
    );
    expect(still?.opted).toBe(true);
  });

  it('answers whether a thread opted out only to those who read customers or send messages, in the request’s companies', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const ask = (who: Principal) =>
      rows(who, sql`select app.whatsapp_thread_opted_out(${thread.thread_id}::uuid)`);
    expect(await failure(ask(await createTestPrincipal('hr_admin', [1])))).toMatch(/is required/);
    expect(await failure(ask(await createTestPrincipal('general_manager', [2])))).toMatch(
      /no company of the request/,
    );
    expect(await ask(customer.owner)).toHaveLength(1);
  });

  it('a confirmation goes only to a number that opted out', async () => {
    const thread = await openThread(await whatsappCustomer(1));
    expect(
      await failure(
        rows(
          workers([1]),
          sql`select * from app.whatsapp_queue_message(${thread.thread_id}::uuid, 'system', 'stop_note', '[]'::jsonb)`,
        ),
      ),
    ).toMatch(/one confirmation/);
  });
});

describe('the messaging worker’s definers', () => {
  it('take a queued message once, record it sent with Meta’s id or refused, and nothing after', async () => {
    const thread = await openThread(await whatsappCustomer(1));
    const [queued] = await rows<{ message_id: string }>(
      workers([1]),
      sql`select * from app.whatsapp_queue_message(${thread.thread_id}::uuid, 'template', 'hello_world', '[]'::jsonb)`,
    );
    const id = queued?.message_id ?? '';
    const [facts] = await rows<{
      status: string;
      send_attempted: boolean;
      wa_id: string;
      phone_number_id: string;
      opted_out: boolean;
      sent_last_hour: number;
    }>(workers([1]), sql`select * from app.whatsapp_send_facts(${id}::uuid)`);
    expect(facts).toMatchObject({
      status: 'queued',
      send_attempted: false,
      phone_number_id: channel1.phoneNumberId,
      opted_out: false,
      sent_last_hour: 0,
    });
    // Sent needs a message taken; refused one not taken.
    const record = (status: string, wamid: string | null, refusal: string | null) =>
      rows<{ status: string; changed: boolean }>(
        workers([1]),
        sql`select status, changed from app.whatsapp_record_send(${id}::uuid, ${status}, ${wamid}, ${refusal}, null)`,
      );
    expect((await record('sent', `wamid.${newId()}`, null))[0]).toEqual({
      status: 'queued',
      changed: false,
    });
    const claim = sql`select app.whatsapp_claim_send(${id}::uuid) as claimed`;
    expect((await rows<{ claimed: boolean }>(workers([1]), claim))[0]?.claimed).toBe(true);
    expect((await rows<{ claimed: boolean }>(workers([1]), claim))[0]?.claimed).toBe(false);
    expect((await record('refused', null, 'opted_out'))[0]).toEqual({
      status: 'queued',
      changed: false,
    });
    expect((await record('failed', null, null))[0]).toEqual({ status: 'failed', changed: true });
    expect((await record('sent', `wamid.${newId()}`, null))[0]).toEqual({
      status: 'failed',
      changed: false,
    });
    const [after] = await rows<{ sent_last_hour: number }>(
      workers([1]),
      sql`select sent_last_hour from app.whatsapp_send_facts(${id}::uuid)`,
    );
    expect(after?.sent_last_hour).toBe(1);
    for (const who of [exec1, gm1]) {
      for (const call of [
        claim,
        sql`select * from app.whatsapp_send_facts(${id}::uuid)`,
        sql`select * from app.whatsapp_hand_off(${thread.thread_id}::uuid, 'keyword')`,
      ]) {
        expect(await failure(rows(who, call))).toMatch(/messaging.process is required/);
      }
    }
    // Another company's request finds nothing.
    expect(await rows(workers([2]), sql`select * from app.whatsapp_send_facts(${id}::uuid)`)).toEqual([]);
  });

  it('hand a thread to people once, keeping the first reason', async () => {
    const thread = await openThread(await whatsappCustomer(1));
    const handOff = (reason: string) =>
      rows<{ handled_by: string; handoff_reason: string; changed: boolean }>(
        workers([1]),
        sql`select * from app.whatsapp_hand_off(${thread.thread_id}::uuid, ${reason})`,
      );
    expect((await handOff('keyword'))[0]).toEqual({
      handled_by: 'people',
      handoff_reason: 'keyword',
      changed: true,
    });
    expect((await handOff('complaint'))[0]).toEqual({
      handled_by: 'people',
      handoff_reason: 'keyword',
      changed: false,
    });
  });
});

describe('whatsapp_templates', () => {
  it('are registered by an Executive as pending, their status recorded only by the platform', async () => {
    const name = `t_${newId().replaceAll('-', '').slice(-12)}`;
    const id = newId();
    const insert = (who: Principal, status: string) =>
      rows(
        who,
        sql`insert into whatsapp_templates (id, entity_id, name, category, status, created_by)
            values (${status === 'pending' ? id : newId()}, 1, ${name}, 'utility', ${status}, ${who.id})`,
      );
    expect(await failure(insert(gm1, 'pending'))).toMatch(/row-level security/);
    expect(await failure(insert(exec1, 'approved'))).toMatch(/row-level security/);
    await insert(exec1, 'pending');
    expect(
      await failure(
        rows(exec1, sql`update whatsapp_templates set status = 'approved' where id = ${id}`),
      ),
    ).toMatch(/permission denied/);
    // Every principal of the company reads it, nobody of another.
    const read = sql`select id from whatsapp_templates where id = ${id}`;
    expect(await rows(otherCaller, read)).toHaveLength(1);
    expect(await rows(await createTestPrincipal('executive', [2]), read)).toHaveLength(0);
    const status = (who: Principal, s: string) =>
      rows<{ template_id: string; entity_id: number; previous_status: string }>(
        who,
        sql`select * from app.whatsapp_record_template_status(${name}, 'en', ${s})`,
      );
    expect(await failure(status(exec1, 'approved'))).toMatch(/messaging.process is required/);
    expect(await status(workers([2]), 'approved')).toEqual([]);
    expect(await status(workers([1]), 'approved')).toEqual([
      { template_id: id, entity_id: 1, previous_status: 'pending' },
    ]);
    expect(await status(workers([1]), 'approved')).toEqual([]);
  });
});
