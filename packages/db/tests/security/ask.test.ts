import { newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestUser,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5, DATABASE §6.9): a conversation and
// its messages are their person's alone, read in a request covering every company the
// conversation covers, written with knowledge.ask, removed by the person or by the retention
// sweep. The suites never clean these tables, so every row here is found by this run's own ids.

afterAll(closeDb);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
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

const companies = (ids: readonly number[]) => sql`${`{${ids.join(',')}}`}::smallint[]`;

/** A conversation with one message, written as the person through the policies. */
async function ask(principal: Principal, entityIds: number[]): Promise<{ c: string; m: string }> {
  const c = newId();
  const m = newId();
  const one = entityIds.length === 1 ? entityIds[0] : null;
  await asPrincipal(principal, async ({ tx }) => {
    await tx.execute(sql`insert into ask_conversations (id, user_id, entity_id, entity_ids, title)
      values (${c}, ${principal.id}, ${one}, ${companies(entityIds)}, 'How many leads came in?')`);
    await tx.execute(sql`insert into ask_messages (id, conversation_id, user_id, entity_id, entity_ids,
                                                   question, answer, outcome)
      values (${m}, ${c}, ${principal.id}, ${one}, ${companies(entityIds)},
              'How many leads came in?', 'Twelve leads.', 'answered')`);
  });
  return { c, m };
}

let gm: Principal;
let gmIn1: Principal;
let otherGm: Principal;
let caller: Principal;

beforeAll(async () => {
  const gmUser = await createTestUser([
    { entityId: 1, roleKey: 'general_manager' },
    { entityId: 2, roleKey: 'general_manager' },
  ]);
  const otherUser = await createTestUser([{ entityId: 1, roleKey: 'general_manager' }]);
  const callerUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
  gm = principalFor('general_manager', [1, 2], { id: gmUser.id });
  gmIn1 = principalFor('general_manager', [1], { id: gmUser.id });
  otherGm = principalFor('general_manager', [1], { id: otherUser.id });
  caller = principalFor('tele_caller_cc', [1], { id: callerUser.id });
});

describe('ask_conversations and ask_messages (DATABASE §6.9)', () => {
  it('shows a person their own conversations only, and one of several companies only in a request covering them all', async () => {
    const single = await ask(gm, [1]);
    const both = await ask(gm, [1, 2]);
    const others = await ask(otherGm, [1]);
    const ids = [single.c, both.c, others.c];
    const seen = async (p: Principal) =>
      (
        await rows<{ id: string }>(
          p,
          sql`select id from ask_conversations where id = any(${`{${ids.join(',')}}`}::uuid[]) order by id`,
        )
      ).map((r) => r.id);
    expect(await seen(gm)).toEqual([single.c, both.c].sort());
    expect(await seen(gmIn1)).toEqual([single.c]);
    expect(await seen(otherGm)).toEqual([others.c]);
    const messages = await rows<{ id: string }>(
      gmIn1,
      sql`select id from ask_messages where conversation_id = any(${`{${ids.join(',')}}`}::uuid[])`,
    );
    expect(messages.map((r) => r.id)).toEqual([single.m]);
    // With no context at all, nothing.
    expect(
      await withoutContext(sql`select id from ask_conversations where id = ${single.c}`),
    ).toEqual([]);
    expect(await withoutContext(sql`select id from ask_messages where id = ${single.m}`)).toEqual(
      [],
    );
  });

  it('is written only with knowledge.ask, as oneself, for companies of the request', async () => {
    const id = newId();
    // A tele-caller holds no knowledge.ask.
    expect(
      await failure(
        rows(
          caller,
          sql`insert into ask_conversations (id, user_id, entity_id, entity_ids, title)
              values (${id}, ${caller.id}, 1, ${companies([1])}, 'question')`,
        ),
      ),
    ).toMatch(/row-level security/);
    // Never as another person.
    expect(
      await failure(
        rows(
          gmIn1,
          sql`insert into ask_conversations (id, user_id, entity_id, entity_ids, title)
              values (${id}, ${otherGm.id}, 1, ${companies([1])}, 'question')`,
        ),
      ),
    ).toMatch(/row-level security/);
    // Never for a company outside the request.
    expect(
      await failure(
        rows(
          gmIn1,
          sql`insert into ask_conversations (id, user_id, entity_id, entity_ids, title)
              values (${id}, ${gm.id}, 2, ${companies([2])}, 'question')`,
        ),
      ),
    ).toMatch(/row-level security/);
    // A message names its person's conversation with its companies: another's is refused by the
    // foreign key (which hides whose it is), another set of companies too.
    const mine = await ask(gm, [1]);
    expect(
      await failure(
        rows(
          otherGm,
          sql`insert into ask_messages (id, conversation_id, user_id, entity_id, entity_ids, question, answer, outcome)
              values (${newId()}, ${mine.c}, ${otherGm.id}, 1, ${companies([1])}, 'q', 'a', 'answered')`,
        ),
      ),
    ).toMatch(/foreign key/);
    expect(
      await failure(
        rows(
          gm,
          sql`insert into ask_messages (id, conversation_id, user_id, entity_id, entity_ids, question, answer, outcome)
              values (${newId()}, ${mine.c}, ${gm.id}, null, ${companies([1, 2])}, 'q', 'a', 'answered')`,
        ),
      ),
    ).toMatch(/foreign key/);
  });

  it('keeps the company columns in step', async () => {
    expect(
      await failure(
        rows(
          gm,
          sql`insert into ask_conversations (id, user_id, entity_id, entity_ids, title)
              values (${newId()}, ${gm.id}, 1, ${companies([1, 2])}, 'question')`,
        ),
      ),
    ).toMatch(/ask_conversations_companies_check/);
    expect(
      await failure(
        rows(
          gm,
          sql`insert into ask_conversations (id, user_id, entity_id, entity_ids, title)
              values (${newId()}, ${gm.id}, null, ${companies([1])}, 'question')`,
        ),
      ),
    ).toMatch(/ask_conversations_companies_check/);
  });

  it('changes only a conversation’s last-used time, never a message, and removes a conversation with its messages', async () => {
    const mine = await ask(gm, [1]);
    expect(
      await failure(
        rows(gm, sql`update ask_conversations set title = 'changed' where id = ${mine.c}`),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(rows(gm, sql`update ask_messages set answer = 'changed' where id = ${mine.m}`)),
    ).toMatch(/permission denied/);
    expect(await failure(rows(gm, sql`delete from ask_messages where id = ${mine.m}`))).toMatch(
      /permission denied/,
    );
    // Another person's delete touches nothing.
    await rows(otherGm, sql`delete from ask_conversations where id = ${mine.c}`);
    const kept = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from ask_messages where id = ${mine.m}`,
    );
    expect(kept[0]?.n).toBe(1);
    await rows(gm, sql`update ask_conversations set updated_at = now() where id = ${mine.c}`);
    await rows(gm, sql`delete from ask_conversations where id = ${mine.c}`);
    const gone = await asMigrator(
      (m) => m<{ n: number }[]>`
        select (select count(*) from ask_conversations where id = ${mine.c})::int
             + (select count(*) from ask_messages where id = ${mine.m})::int as n`,
    );
    expect(gone[0]?.n).toBe(0);
  });

  it('is removed by the retention sweep, which no request role may run', async () => {
    const old = await ask(gm, [1]);
    const recent = await ask(gm, [1]);
    const oldMessageInRecent = newId();
    await asMigrator(async (m) => {
      await m`update ask_conversations set updated_at = now() - interval '91 days' where id = ${old.c}`;
      await m`update ask_messages set created_at = now() - interval '91 days' where id = ${old.m}`;
      await m`insert into ask_messages (id, conversation_id, user_id, entity_id, entity_ids, question, answer, outcome, created_at)
        values (${oldMessageInRecent}, ${recent.c}, ${gm.id}, 1, '{1}', 'q', 'a', 'answered', now() - interval '91 days')`;
    });
    expect(await failure(rows(gm, sql`select app.purge_ask_conversations(90)`))).toMatch(
      /permission denied/,
    );
    await asMigrator((m) => m`select app.purge_ask_conversations(90)`);
    const left = await asMigrator(
      (m) => m<{ id: string }[]>`
        select id from ask_conversations where id in (${old.c}, ${recent.c})
        union all
        select id from ask_messages where id in (${old.m}, ${recent.m}, ${oldMessageInRecent})`,
    );
    expect(left.map((r) => r.id).sort()).toEqual([recent.c, recent.m].sort());
    expect(await failure(asMigrator((m) => m`select app.purge_ask_conversations(0)`))).toMatch(
      /at least 1/,
    );
  });

  it('runs the sweep daily with its time limits', async () => {
    const [job] = await asMigrator(
      (m) => m<{ schedule: string; command: string }[]>`
        select schedule, command from cron.job where jobname = 'ask-conversations-purge'`,
    );
    expect(job?.schedule).toBe('50 2 * * *');
    expect(job?.command).toMatch(
      /^set lock_timeout = '5s'; set statement_timeout = '5min'; select app\.purge_ask_conversations\(\d+\)$/,
    );
  });
});
