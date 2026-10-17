// The nightly rescoring's batch read at a production volume (G1; C3 review L8):
// `pnpm --filter @shakti/domain exec tsx tests/spike/rescore-explain.ts`. Fills the local database
// with 240,000 made-up leads over the four companies (60, 20, 12 and 8 per cent, made in one
// interleaved run so each company's ids are spread through the key's order, as a year of imports
// and enquiries leaves them), 30 per cent open or in nurture and the rest won or lost, then prints
// `EXPLAIN (ANALYZE, BUFFERS)` for the facts definer's batch query (`app.lead_score_facts()`, its
// body run as the table owner, as the definer runs it) for the largest and the smallest company:
// the first batch, a batch from the middle and the last, and the whole walk's time through the
// definer itself as the worker principal. Everything it made is removed at the end. Local
// database only (prepareDatabase refuses any other host). Not part of CI; it lives under tests/
// for the testing helpers.
import { SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';

const LEADS = 240_000;
/** Each company's share of the leads, by its id. */
const SHARES: readonly [number, number][] = [
  [1, 0.6],
  [2, 0.2],
  [3, 0.12],
  [4, 0.08],
];
const BATCH = 1000;
const NAME = 'EXPLR customer %';

/** The definer's own query, with its parameters written in. */
function batchQuery(entity: number, after: string | null): string {
  return `select o.id, p.segment, ls.code, cs.district, o.created_at, o.score, o.score_reasons_json,
                 o.score_changed_at::text
            from public.opportunities o
            join public.pipelines p on p.id = o.pipeline_id
            left join public.lead_sources ls on ls.id = o.source_id
            left join public.customer_sites cs on cs.id = o.site_id
           where o.entity_id = ${String(entity)}
             and o.archived_at is null
             and o.state in ('open', 'nurture')
             and (${after === null ? 'null::uuid' : `'${after}'::uuid`} is null or o.id > ${after === null ? 'null::uuid' : `'${after}'::uuid`})
           order by o.id
           limit ${String(BATCH)}`;
}

async function cleanUp(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from opportunities where account_id in
                 (select id from accounts where name like ${NAME})`;
      await tx`delete from account_entities where account_id in
                 (select id from accounts where name like ${NAME})`;
      await tx`delete from accounts where name like ${NAME}`;
    }),
  );
}

async function explain(label: string, query: string): Promise<void> {
  const rows = await asMigrator(
    (m) => m.unsafe(`explain (analyze, buffers, costs off) ${query}`) as Promise<object[]>,
  );
  const plan = rows.map((r) => Object.values(r)[0] as string).join('\n');
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

/** The ids after which the company's batches start: null, then every BATCH-th open lead. */
async function batchStarts(entity: number): Promise<(string | null)[]> {
  const ids = await asMigrator(
    (m) => m<{ id: string }[]>`
      select id from opportunities
       where entity_id = ${entity} and archived_at is null and state in ('open', 'nurture')
       order by id`,
  );
  const starts: (string | null)[] = [null];
  for (let i = BATCH; i < ids.length; i += BATCH) starts.push(ids[i - 1]?.id ?? null);
  return starts;
}

async function main(): Promise<void> {
  await prepareDatabase();
  await cleanUp();
  const exec = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const [pipeline] = await tx<{ id: string; stage: string }[]>`
        select p.id, (select s.id from pipeline_stages s where s.pipeline_id = p.id
                       order by s.position limit 1) as stage
          from pipelines p where p.key = 'residential_rooftop' and p.entity_id is null`;
      if (!pipeline) throw new Error('no residential_rooftop pipeline');
      await tx`insert into accounts (id, type, name, created_by)
               select app.uuid_v7(), 'household', 'EXPLR customer ' || g, ${exec.id}
                 from generate_series(1, ${LEADS}::int) g`;
      // Each customer known to one company, drawn by the shares, with one lead there; the leads'
      // ids are made in one run, so the four companies' leads interleave in the key's order.
      const cuts = SHARES.reduce<number[]>(
        (acc, [, share]) => [...acc, (acc.at(-1) ?? 0) + share],
        [],
      );
      await tx.unsafe(
        `insert into account_entities (id, account_id, entity_id, created_by)
         select app.uuid_v7(), a.id,
                case when r < ${String(cuts[0])} then 1 when r < ${String(cuts[1])} then 2
                     when r < ${String(cuts[2])} then 3 else 4 end,
                '${exec.id}'
           from (select id, random() as r from accounts where name like 'EXPLR customer %') a`,
      );
      await tx.unsafe(
        `insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, state, created_by)
         select app.uuid_v7(), ae.entity_id, ae.account_id, '${pipeline.id}', '${pipeline.stage}',
                case when s < 0.25 then 'open' when s < 0.30 then 'nurture'
                     when s < 0.40 then 'won' else 'lost' end,
                '${exec.id}'
           from (select ae.entity_id, ae.account_id, random() as s
                   from account_entities ae join accounts a on a.id = ae.account_id
                  where a.name like 'EXPLR customer %' order by ae.account_id) ae`,
      );
      await tx`analyze opportunities`;
    }),
  );
  const counts = await asMigrator(
    (m) => m<{ entity: number; leads: number; open: number }[]>`
      select o.entity_id as entity, count(*)::int as leads,
             count(*) filter (where o.state in ('open', 'nurture'))::int as open
        from opportunities o join accounts a on a.id = o.account_id
       where a.name like ${NAME} group by 1 order by 1`,
  );
  process.stdout.write(`made: ${JSON.stringify(counts)}\n`);

  for (const entity of [1, 4]) {
    const starts = await batchStarts(entity);
    const middle = starts[Math.floor(starts.length / 2)] ?? null;
    const last = starts.at(-1) ?? null;
    await explain(`company ${String(entity)}, first batch`, batchQuery(entity, null));
    await explain(`company ${String(entity)}, a middle batch`, batchQuery(entity, middle));
    await explain(`company ${String(entity)}, the last batch`, batchQuery(entity, last));

    // The whole walk as the job makes it: the definer, batch after batch, as the worker.
    const worker = principalFor('system:workers', [entity], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
    const started = performance.now();
    let after: string | null = null;
    let batches = 0;
    let leads = 0;
    for (;;) {
      const rows: { lead_id: string }[] = await asPrincipal(
        worker,
        async (ctx) =>
          (await ctx.tx.execute(
            sql`select lead_id from app.lead_score_facts(${entity}::smallint, ${after}::uuid, ${BATCH})`,
          )) as unknown as { lead_id: string }[],
      );
      batches += 1;
      leads += rows.length;
      if (rows.length < BATCH) break;
      after = rows.at(-1)?.lead_id ?? null;
    }
    process.stdout.write(
      `\ncompany ${String(entity)}: the whole walk through app.lead_score_facts(), ${String(batches)} batches, ${String(leads)} leads, ${String(Math.round(performance.now() - started))} ms\n`,
    );
  }
  await cleanUp();
}

main()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await closeDb();
    process.exit(1);
  });
