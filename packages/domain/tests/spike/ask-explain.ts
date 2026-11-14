// Ask the Business plans (docs/03-roadmap-appendix/phase2.md §6.5, brief B1):
// `pnpm --filter @shakti/domain exec tsx tests/spike/ask-explain.ts`. Fills the local database
// with made-up people (`EXPLN ask person …`): 200 people with 100 conversations each in company 1,
// one of them with 2,000, each conversation with four questions and answers (820,000 messages),
// then prints `EXPLAIN (ANALYZE, BUFFERS)` under the policies as that person for the conversation
// list's first and second page, one conversation's messages, and the retention sweep's two deletes
// as the owner runs them (inside a rolled-back transaction). Everything it made is removed at the
// end. Local database only (prepareDatabase refuses any other host). Not part of CI; it lives
// under tests/ for the testing helpers.
import { type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  prepareDatabase,
  principalFor,
} from '@shakti/db/testing';
import { schema } from '@shakti/db';
import { desc, eq, sql } from 'drizzle-orm';
import { askConversationListQuery } from '../../src/queries/knowledge/ask';

const ENTITY = 1;
const PEOPLE = 200;
const EACH = 100;
const MINE = 2_000;
const TURNS = 4;

function inline(query: { sql: string; params: unknown[] }): string {
  let text = query.sql;
  for (let i = query.params.length; i >= 1; i -= 1) {
    const value = query.params[i - 1];
    const literal =
      typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
    text = text.replaceAll(`$${String(i)}`, literal);
  }
  return text;
}

async function explainAs(label: string, principal: Principal, text: string): Promise<void> {
  const plan = await asPrincipal(principal, async (ctx) => {
    const rows = (await ctx.tx.execute(
      sql.raw(`explain (analyze, buffers, costs off) ${text}`),
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

async function cleanUp(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const people = tx`select id from principals where display_name like 'EXPLN ask person %'`;
      await tx`delete from ask_conversations where user_id in (${people})`;
      await tx`delete from principals where display_name like 'EXPLN ask person %'`;
    }),
  );
}

async function main(): Promise<void> {
  await prepareDatabase();
  await cleanUp();
  let me = '';
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into principals (id, kind, display_name)
               select app.uuid_v7(), 'user', 'EXPLN ask person ' || lpad(g::text, 4, '0')
                 from generate_series(1, ${PEOPLE}::int) g`;
      const [mine] = await tx<{ id: string }[]>`
        select id from principals where display_name = 'EXPLN ask person 0001'`;
      if (!mine) throw new Error('no person');
      me = mine.id;
      await tx`insert into ask_conversations (id, user_id, entity_id, entity_ids, title, created_at, updated_at)
               select app.uuid_v7(), p.id, ${ENTITY}, array[${ENTITY}]::smallint[],
                      'EXPLN question ' || g, now() - make_interval(mins => g), now() - make_interval(mins => g)
                 from principals p
                 cross join lateral generate_series(1,
                   case when p.id = ${me}::uuid then ${MINE}::int else ${EACH}::int end) g
                where p.display_name like 'EXPLN ask person %'`;
      await tx`insert into ask_messages (id, conversation_id, user_id, entity_id, entity_ids, question, answer,
                                         outcome, created_at)
               select app.uuid_v7(), c.id, c.user_id, c.entity_id, c.entity_ids, 'EXPLN question',
                      'EXPLN answer', 'answered', c.updated_at - make_interval(secs => t)
                 from ask_conversations c
                 cross join generate_series(1, ${TURNS}::int) t
                where c.title like 'EXPLN question %'`;
      await tx`analyze ask_conversations`;
      await tx`analyze ask_messages`;
    }),
  );
  const person = principalFor('general_manager', [ENTITY], { id: me });

  const first = await asPrincipal(person, (ctx) =>
    Promise.resolve(inline(askConversationListQuery(ctx, undefined).toSQL())),
  );
  await explainAs('conversation list, first page', person, first);

  const [page] = await asPrincipal(person, (ctx) =>
    askConversationListQuery(ctx, undefined).offset(29),
  );
  if (page === undefined) throw new Error('no page');
  const second = await asPrincipal(person, (ctx) =>
    Promise.resolve(
      inline(askConversationListQuery(ctx, { t: page.updatedText, id: page.row.id }).toSQL()),
    ),
  );
  await explainAs('conversation list, second page', person, second);

  const m = schema.askMessages;
  const one = await asPrincipal(person, (ctx) =>
    Promise.resolve(
      inline(
        ctx.tx
          .select()
          .from(m)
          .where(eq(m.conversationId, page.row.id))
          .orderBy(desc(m.createdAt), desc(m.id))
          .toSQL(),
      ),
    ),
  );
  await explainAs("one conversation's messages", person, one);

  // The sweep's deletes as pg_cron runs them (as the owner), rolled back.
  await asMigrator((o) =>
    o
      .begin(async (tx) => {
        for (const [label, text] of [
          [
            'sweep: messages asked 90 days ago',
            `delete from ask_messages where created_at < now() - make_interval(days => 90)`,
          ],
          [
            'sweep: conversations last used 90 days ago',
            `delete from ask_conversations where updated_at < now() - make_interval(days => 90)`,
          ],
        ] as const) {
          const rows = await tx.unsafe<Record<string, string>[]>(
            `explain (analyze, buffers, costs off) ${text}`,
          );
          process.stdout.write(
            `\n=== ${label} ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`,
          );
        }
        throw new Error('rollback');
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== 'rollback') throw e;
      }),
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanUp();
    await closeDb();
  });
