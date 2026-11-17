import { AGENT_PRINCIPAL_IDS, newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  principalFor,
  testPhone,
  whatsappChannel,
  whatsappCustomer,
  type WhatsAppChannelFixture,
  type WhatsAppCustomerFixture,
} from '../../src/testing/index';

// A3 WhatsApp Concierge, the thread binding (docs/03-roadmap-appendix/phase2.md §7.2, migration
// a3_thread_binding): an agent principal's run is bound to one WhatsApp thread by
// `app.agent_thread_id`, which only `withRequestContext()` sets and only for an agent. For the
// Concierge (`own` scopes), the binding opens the thread's customer, lead, tasks, the thread
// itself and what is read through them (messages, contacts, phones, consents, a chat's files),
// and the approved Playbook directives for customers; unbound, it reads nothing at all. The
// suites never clean these tables, so every row is found by this run's own ids.

afterAll(closeDb);

const SHA = 'c3'.repeat(32);
const CONCIERGE_ID = AGENT_PRINCIPAL_IDS['agent:concierge'];

/** The Concierge's seeded principal in the given companies, as the agent runtime builds it. */
const concierge = (entityIds: number[] = [1]): Principal =>
  principalFor('agent:concierge', entityIds, { id: CONCIERGE_ID });

/** A chat: a customer of the company with its lead, thread, a message with a photo, a consent and a callback. */
interface Chat extends WhatsAppCustomerFixture {
  threadId: string;
  messageId: string;
  fileId: string;
  consentId: string;
  taskId: string;
}

let channels: Record<number, WhatsAppChannelFixture>;
let creator: Principal;

/** A thread of the customer's number on the company's channel, with one inbound photo message. */
async function thread(
  customer: WhatsAppCustomerFixture,
  waId: string,
): Promise<{ threadId: string; messageId: string; fileId: string }> {
  const channel = channels[customer.entityId];
  if (!channel) throw new Error('no channel');
  const threadId = newId();
  const messageId = newId();
  const fileId = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into whatsapp_threads (id, entity_id, channel_id, account_id, wa_id,
                                             opportunity_id, assignee_id, created_by)
        values (${threadId}, ${customer.entityId}, ${channel.channelId}, ${customer.accountId},
                ${waId}, ${customer.opportunityId}, ${customer.owner.id}, ${creator.id})`;
      await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                  sha256, status, created_by)
        values (${fileId}, ${customer.entityId}, 'whatsapp_media', 'test',
                ${`whatsapp/${fileId}.jpg`}, 'photo.jpg', 'image/jpeg', 10, ${SHA}, 'ready',
                ${creator.id})`;
      await tx`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind,
                                              provider_message_id, body_masked, file_id)
        values (${messageId}, ${customer.entityId}, ${threadId}, 'inbound', 'media',
                ${`wamid.${messageId}`}, 'my roof', ${fileId})`;
    }),
  );
  return { threadId, messageId, fileId };
}

async function chat(entityId: number): Promise<Chat> {
  const customer = await whatsappCustomer(entityId);
  const made = await thread(customer, customer.waId);
  const consentId = newId();
  const taskId = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into consents (id, contact_id, channel, purpose, source, text_version,
                                     given_at, created_by)
        values (${consentId}, ${customer.contactId}, 'whatsapp', 'service', 'whatsapp_opt_in',
                'test', now(), ${creator.id})`;
      await tx`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id,
                                  kind, title, due_at, created_by)
        values (${taskId}, ${entityId}, ${customer.opportunityId}, ${customer.accountId},
                ${customer.owner.id}, ${customer.teamId}, 'callback', 'Call back',
                now() + interval '1 day', ${creator.id})`;
    }),
  );
  return { ...customer, ...made, consentId, taskId };
}

/** Runs a query as `principal`, bound to `threadId` when one is given. */
async function read<T = Record<string, unknown>>(
  principal: Principal,
  threadId: string | undefined,
  query: SQL,
): Promise<T[]> {
  return withRequestContext(
    principal,
    threadId === undefined ? {} : { agentThreadId: threadId },
    async ({ tx }) => (await tx.execute(query)) as unknown as T[],
  );
}

/** What of a chat the caller reads, table by table, by the chat's own ids. */
async function seen(
  principal: Principal,
  threadId: string | undefined,
  c: Chat,
): Promise<Record<string, number>> {
  const [row] = await read<Record<string, string>>(
    principal,
    threadId,
    sql`select
      (select count(*) from account_entities where account_id = ${c.accountId})::int as customer_links,
      (select count(*) from accounts where id = ${c.accountId})::int as customers,
      (select count(*) from contacts where id = ${c.contactId})::int as contacts,
      (select count(*) from contact_phones where id = ${c.phoneId})::int as phones,
      (select count(*) from consents where id = ${c.consentId})::int as consents,
      (select count(*) from opportunities where id = ${c.opportunityId})::int as leads,
      (select count(*) from tasks where id = ${c.taskId})::int as tasks,
      (select count(*) from whatsapp_threads where id = ${c.threadId})::int as threads,
      (select count(*) from whatsapp_messages where id = ${c.messageId})::int as messages,
      (select count(*) from files where id = ${c.fileId})::int as files`,
  );
  return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)]));
}

const ALL = {
  customer_links: 1,
  customers: 1,
  contacts: 1,
  phones: 1,
  consents: 1,
  leads: 1,
  tasks: 1,
  threads: 1,
  messages: 1,
  files: 1,
};
const NOTHING = Object.fromEntries(Object.keys(ALL).map((k) => [k, 0]));

let a: Chat;
let b: Chat;
let elsewhere: Chat;

beforeAll(async () => {
  creator = await createTestPrincipal('executive', [1, 2]);
  channels = { 1: await whatsappChannel(1), 2: await whatsappChannel(2) };
  a = await chat(1);
  b = await chat(1);
  elsewhere = await chat(2);
});

describe('a Concierge run bound to one thread', () => {
  it("reads that thread's customer, lead, callbacks, chat and files", async () => {
    expect(await seen(concierge(), a.threadId, a)).toEqual(ALL);
  });

  it('reads nothing of another customer of the same company', async () => {
    expect(await seen(concierge(), a.threadId, b)).toEqual(NOTHING);
    expect(await seen(concierge(), b.threadId, a)).toEqual(NOTHING);
  });

  it('reads nothing at all when it is bound to no thread', async () => {
    for (const c of [a, b, elsewhere]) {
      expect(await seen(concierge(), undefined, c)).toEqual(NOTHING);
    }
    const [row] = await read<{ n: string }>(
      concierge(),
      undefined,
      sql`select ((select count(*) from account_entities) + (select count(*) from opportunities)
                + (select count(*) from whatsapp_threads) + (select count(*) from tasks))::int as n`,
    );
    expect(Number(row?.n)).toBe(0);
  });

  it('reads only its own thread of a customer who writes from two numbers', async () => {
    const second = await thread(a, `91${testPhone()}`);
    const threads = await read<{ id: string }>(
      concierge(),
      a.threadId,
      sql`select id from whatsapp_threads where account_id = ${a.accountId}`,
    );
    expect(threads.map((t) => t.id)).toEqual([a.threadId]);
    const messages = await read(
      concierge(),
      a.threadId,
      sql`select id from whatsapp_messages where id = ${second.messageId}`,
    );
    expect(messages).toEqual([]);
    const files = await read(
      concierge(),
      a.threadId,
      sql`select id from files where id = ${second.fileId}`,
    );
    expect(files).toEqual([]);
  });

  it("reads only the thread's lead, not the customer's other leads", async () => {
    const other = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id,
                                          team_id, created_by)
        select ${other}, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by
          from opportunities where id = ${a.opportunityId}`,
    );
    const leads = await read<{ id: string }>(
      concierge(),
      a.threadId,
      sql`select id from opportunities where account_id = ${a.accountId}`,
    );
    expect(leads.map((l) => l.id)).toEqual([a.opportunityId]);
  });

  it('reads nothing of a thread of a company outside the request', async () => {
    expect(await seen(concierge([1]), elsewhere.threadId, elsewhere)).toEqual(NOTHING);
    expect(await seen(concierge([1]), elsewhere.threadId, a)).toEqual(NOTHING);
    // In its own company the same binding opens it.
    expect(await seen(concierge([2]), elsewhere.threadId, elsewhere)).toEqual(ALL);
  });

  it('opens nothing to an agent role whose principal is not a seeded agent', async () => {
    const stray = principalFor('agent:concierge', [1]);
    expect(await seen(stray, a.threadId, a)).toEqual(NOTHING);
  });

  it('writes nothing: the agent own scope still changes no lead and queues no message', async () => {
    const updated = await read(
      concierge(),
      a.threadId,
      sql`update opportunities set updated_at = now() where id = ${a.opportunityId} returning id`,
    );
    expect(updated).toEqual([]);
    const threads = await read(
      concierge(),
      a.threadId,
      sql`update whatsapp_threads set needs_reply = true where id = ${a.threadId} returning id`,
    );
    expect(threads).toEqual([]);
  });
});

describe('who may bind a request to a thread', () => {
  it('refuses a person, the workers and a malformed thread id before the transaction', async () => {
    for (const who of [
      principalFor('executive', [1]),
      principalFor('tele_caller_cc', [1]),
      principalFor('system:workers', [1]),
    ]) {
      await expect(read(who, a.threadId, sql`select 1`)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(read(concierge(), 'not-a-thread', sql`select 1`)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('opens nothing to a person who sets the binding by hand', async () => {
    const caller = principalFor('tele_caller_cc', [1]);
    const [row] = await withRequestContext(caller, {}, async ({ tx }) => {
      await tx.execute(sql`select set_config('app.agent_thread_id', ${a.threadId}, true)`);
      return (await tx.execute(
        sql`select (select count(*) from account_entities where account_id = ${a.accountId})::int as n`,
      )) as unknown as { n: string }[];
    });
    expect(Number(row?.n)).toBe(0);
  });

  it('narrows another agent bound to a thread to that thread alone', async () => {
    // The seeded Chief of Staff, which reads customers at company scope.
    const chief = principalFor('agent:chief', [1], { id: AGENT_PRINCIPAL_IDS['agent:chief'] });
    const unbound = await read<{ id: string }>(
      chief,
      undefined,
      sql`select id from whatsapp_threads where id in (${a.threadId}, ${b.threadId})`,
    );
    expect(unbound).toHaveLength(2);
    const bound = await read<{ id: string }>(
      chief,
      a.threadId,
      sql`select id from whatsapp_threads where id in (${a.threadId}, ${b.threadId})`,
    );
    expect(bound.map((t) => t.id)).toEqual([a.threadId]);
  });
});

describe('the Playbook a bound run reads', () => {
  const directives: Record<string, string> = {};

  beforeAll(async () => {
    for (const [name, audience, state, entityId] of [
      ['customer', 'customer', 'approved', 1],
      ['group', 'customer', 'approved', null],
      ['draft', 'customer', 'draft', 1],
      ['staff', 'staff', 'approved', 1],
      ['management', 'management', 'approved', 1],
      ['other_company', 'customer', 'approved', 2],
    ] as const) {
      const id = newId();
      directives[name] = id;
      const approved = state === 'approved';
      await asMigrator(
        (m) => m`insert into playbook_directives (id, entity_id, type, audience, title, text, state,
                                                  approved_by, approved_at, checked_at, created_by)
          values (${id}, ${entityId}, 'faq', ${audience}, 'Binding suite', 'A rule.', ${state},
                  ${approved ? creator.id : null}, ${approved ? new Date() : null},
                  ${approved ? new Date() : null}, ${creator.id})`,
      );
    }
  });

  const readable = async (threadId: string | undefined): Promise<string[]> => {
    const ids = Object.values(directives);
    const rows = await read<{ id: string }>(
      concierge(),
      threadId,
      sql`select id from playbook_directives where id = any (${`{${ids.join(',')}}`}::uuid[])`,
    );
    const names = Object.fromEntries(Object.entries(directives).map(([k, v]) => [v, k]));
    return rows.map((r) => names[r.id] ?? r.id).sort();
  };

  it("reads the approved directives for customers of its company and the group's", async () => {
    expect(await readable(a.threadId)).toEqual(['customer', 'group']);
  });

  it('reads none unbound', async () => {
    expect(await readable(undefined)).toEqual([]);
  });
});
