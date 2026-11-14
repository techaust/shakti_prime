// WhatsApp plans (docs/03-roadmap-appendix/phase2.md §6.1, brief W1): `pnpm --filter @shakti/domain
// exec tsx tests/spike/whatsapp-explain.ts`. Fills the local database, in company 2, with made-up
// callers and customers (`EXPLW …`): 20,000 customers, each with a lead of one of 50 callers and a
// WhatsApp chat, a third of the chats waiting for a reply, 10 messages on each chat over 20 days and
// 2,000 on one; then prints `EXPLAIN (ANALYZE, BUFFERS)` under the policies for `/messages`' first
// page as a General Manager and as a caller, its second page, the chat's newest page and the page
// before it, and a customer's chats (Account 360). Everything it made is removed at the end. Local
// database only (prepareDatabase refuses any other host). Not part of CI.
import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  prepareDatabase,
  principalFor,
  PIPELINE_SEED,
  stageId,
  whatsappChannel,
} from '@shakti/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import { threadMessagesSql, waitingThreadsSql } from '../../src/queries/messaging/whatsapp';

const ENTITY = 2;
const CALLERS = 50;
const CUSTOMERS = 20_000;
const PER_THREAD = 10;
const BIG = 2_000;

async function explain(label: string, principal: Principal, query: SQL): Promise<void> {
  const plan = await asPrincipal(principal, async (ctx) => {
    const rows = (await ctx.tx.execute(
      sql`explain (analyze, buffers, costs off) ${query}`,
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

async function main(): Promise<void> {
  await prepareDatabase();
  const channel = await whatsappChannel(ENTITY);
  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('pipeline seed missing');
  const team = newId();
  const callers = Array.from({ length: CALLERS }, () => newId());
  process.stdout.write('filling…\n');
  await asMigrator(async (m) => {
    await m`insert into teams (id, entity_id, name) values (${team}, ${ENTITY}, 'EXPLW team')`;
    for (const id of callers) {
      await m`insert into principals (id, kind, display_name) values (${id}, 'user', 'EXPLW caller')`;
    }
    await m`
      create temporary table explw as
      select i, gen_random_uuid() as account, gen_random_uuid() as contact,
             gen_random_uuid() as phone, gen_random_uuid() as lead, gen_random_uuid() as thread,
             (${callers}::uuid[])[1 + (i % ${CALLERS})] as owner,
             '9170' || lpad(i::text, 8, '0') as wa
        from generate_series(1, ${CUSTOMERS}) i`;
    const by = callers[0] ?? '';
    await m`insert into contacts (id, name, created_by) select contact, 'EXPLW contact ' || i, ${by} from explw`;
    await m`insert into contact_phones (id, contact_id, e164, created_by) select phone, contact, '+' || wa, ${by} from explw`;
    await m`insert into accounts (id, type, name, created_by) select account, 'farm', 'EXPLW customer ' || i, ${by} from explw`;
    await m`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
            select gen_random_uuid(), account, ${ENTITY}, owner, ${team}, ${by} from explw`;
    await m`insert into account_contacts (account_id, contact_id, role, created_by)
            select account, contact, 'owner', ${by} from explw`;
    await m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
            select lead, ${ENTITY}, account, ${pipeline.id}, ${stageId(1, 1)}, owner, ${team}, ${by} from explw`;
    await m`insert into whatsapp_threads (id, entity_id, channel_id, wa_id, account_id, contact_phone_id,
                   opportunity_id, assignee_id, window_open_until, last_inbound_at, needs_reply, created_by)
            select thread, ${ENTITY}, ${channel.channelId}, wa, account, phone, lead, owner,
                   now() - (i % 400) * interval '1 hour' + interval '1 day',
                   now() - (i % 400) * interval '1 hour', i % 3 = 0, ${by}
              from explw`;
    await m`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, provider_message_id, body_masked, created_at)
            select gen_random_uuid(), ${ENTITY}, e.thread, 'inbound', 'text', 'wamid.explw.' || e.i || '.' || n,
                   'EXPLW message', now() - (n * 2) * interval '1 day' / ${PER_THREAD} - (e.i % 400) * interval '1 minute'
              from explw e cross join generate_series(1, ${PER_THREAD}) n`;
    await m`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, provider_message_id, body_masked, created_at)
            select gen_random_uuid(), ${ENTITY}, e.thread, 'inbound', 'text', 'wamid.explw.big.' || n,
                   'EXPLW message', now() - n * interval '15 minutes'
              from explw e cross join generate_series(1, ${BIG}) n where e.i = 3`;
    await m`analyze whatsapp_threads`;
    await m`analyze whatsapp_messages`;
    await m`analyze account_entities`;
    await m`analyze opportunities`;
  });
  const [big] = await asMigrator(
    (m) => m<{ thread: string; owner: string; account: string }[]>`
      select t.id as thread, t.assignee_id as owner, t.account_id as account
        from whatsapp_threads t where t.wa_id = '917000000003'`,
  );
  if (!big) throw new Error('no big thread');
  const gm = principalFor('general_manager', [ENTITY]);
  const caller = principalFor('tele_caller_cc', [ENTITY], { id: big.owner, teamId: team });
  const ctx = (p: Principal) => ({ tx: undefined as never, principal: p, entityIds: [ENTITY] });

  try {
    await explain('/messages, first page, General Manager', gm, waitingThreadsSql(ctx(gm), 26, ENTITY, undefined));
    await explain('/messages, first page, caller (own scope)', caller, waitingThreadsSql(ctx(caller), 26, ENTITY, undefined));
    const [second] = await asMigrator(
      (m) => m<{ t: string; id: string }[]>`
        select last_inbound_at::text as t, id from whatsapp_threads
         where entity_id = ${ENTITY} and needs_reply order by last_inbound_at desc, id desc offset 24 limit 1`,
    );
    await explain(
      '/messages, second page, General Manager',
      gm,
      waitingThreadsSql(ctx(gm), 26, ENTITY, second === undefined ? undefined : second),
    );
    await explain('the chat, newest page (2,010 messages), caller', caller, threadMessagesSql(big.thread, ENTITY, 31, undefined));
    const [older] = await asMigrator(
      (m) => m<{ t: string; id: string }[]>`
        select created_at::text as t, id from whatsapp_messages
         where thread_id = ${big.thread} order by created_at desc, id desc offset 29 limit 1`,
    );
    await explain(
      'the chat, the page before, caller',
      caller,
      threadMessagesSql(big.thread, ENTITY, 31, older === undefined ? undefined : older),
    );
    await explain(
      'a customer’s chats (Account 360), caller',
      caller,
      sql`select t.id from whatsapp_threads t
           where t.account_id = ${big.account}::uuid and t.entity_id = ${ENTITY}
           order by t.last_inbound_at desc nulls last, t.id desc limit 20`,
    );
  } finally {
    process.stdout.write('\nremoving…\n');
    await asMigrator(async (m) => {
      await m`alter table whatsapp_messages disable trigger whatsapp_messages_guard`;
      await m`delete from whatsapp_messages where body_masked = 'EXPLW message'`;
      await m`alter table whatsapp_messages enable trigger whatsapp_messages_guard`;
      await m`delete from whatsapp_threads where wa_id like '9170%' and entity_id = ${ENTITY}`;
      await m`delete from opportunities where team_id = ${team}`;
      await m`delete from account_contacts where account_id in (select id from accounts where name like 'EXPLW customer %')`;
      await m`delete from account_entities where team_id = ${team}`;
      await m`delete from accounts where name like 'EXPLW customer %'`;
      await m`delete from contact_phones where e164 like '+9170%' and contact_id in (select id from contacts where name like 'EXPLW contact %')`;
      await m`delete from contacts where name like 'EXPLW contact %'`;
      await m`delete from teams where id = ${team}`;
      await m`delete from principals where display_name = 'EXPLW caller'`;
    });
    await closeDb();
  }
}

await main();
