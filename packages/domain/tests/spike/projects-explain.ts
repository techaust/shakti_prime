// Project list plans (J1, docs/03-roadmap-appendix/phase4.md §6.1, the lead's note of 27-11-2026):
// `pnpm --filter @shakti/domain exec tsx tests/spike/projects-explain.ts`.
// Fills the local database with 20,000 made-up projects of company 1 and 5,000 of each other
// company (numbers under `PJX/`), each on an order of its own, with five steps each, 200 made-up
// people on 40,000 assignments, and one Field Engineer on 12 projects of company 1; then prints
// `EXPLAIN (ANALYZE, BUFFERS)` of the `/projects` list under the policies as that engineer (whose
// rows the `own` predicate `app.project_is_mine()` decides) and as a Project Manager, with and
// without filters, of the filters' owners, and of the customers' read. Removes what it made at the end. Local database
// only (prepareDatabase refuses any other host). Not part of CI.
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
  tierId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { hasGrant, type Principal } from '@shakti/contracts';
import {
  ownProjectIds,
  ownProjectIdsQuery,
  projectListQuery,
  projectOwnersQuery,
} from '../../src/queries/projects/list-projects';

const PER_COMPANY = { 1: 20_000, 2: 5_000, 3: 5_000, 4: 5_000 } as const;
const PEOPLE = 200;
const PREFIX = 'PJX/';

async function explain(
  label: string,
  who: Principal,
  input: Parameters<typeof projectListQuery>[1],
) {
  await asPrincipal(who, async (ctx) => {
    const only = hasGrant(who.permissions, 'projects.read', 'entity')
      ? undefined
      : await ownProjectIds(ctx, input.entityId);
    if (only !== undefined) {
      const ids = (await ctx.tx.execute(
        sql`explain (analyze, buffers, costs off) ${ownProjectIdsQuery(ctx, input.entityId)}`,
      )) as unknown as Record<string, string>[];
      process.stdout.write(
        `\n=== ${label}: own projects first ===\n${ids.map((r) => Object.values(r)[0]).join('\n')}\n`,
      );
    }
    const query = projectListQuery(ctx, { ...input, only });
    const rows = (await ctx.tx.execute(
      sql`explain (analyze, buffers, costs off) ${query}`,
    )) as unknown as Record<string, string>[];
    process.stdout.write(
      `\n=== ${label} ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`,
    );
  });
}

async function seed(engineer: string, manager: string): Promise<void> {
  await remove();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const account = (
        await tx<{ id: string }[]>`
        insert into accounts (id, type, name, created_by)
        values (app.uuid_v7(), 'farm', 'Plan customer', ${manager}) returning id`
      )[0]?.id;
      if (account === undefined) throw new Error('no plan customer');
      await tx`
        insert into principals (id, kind, display_name)
        select app.uuid_v7(), 'user', 'PJX person ' || g from generate_series(1, ${PEOPLE}::int) g`;
      for (const [entity, n] of Object.entries(PER_COMPANY)) {
        await tx`
          insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, tier_id,
                                    place_of_supply_state, supply_kind, state, subtotal, cgst, sgst, igst,
                                    tax_total, round_off, grand_total, confirmed_at, confirmed_by, created_by)
          select app.uuid_v7(), ${Number(entity)}, ${PREFIX} || 'SO/' || lpad(g::text, 6, '0'), '2098-99',
                 ${account}, 'farm', ${tierId('dealer')}, '08', 'intra', 'confirmed', 0, 0, 0, 0, 0, 0, 0,
                 now(), ${manager}, ${manager}
            from generate_series(1, ${n}::int) g`;
        await tx`
          insert into projects (id, entity_id, project_no, fy, sales_order_id, account_id, segment, scheme,
                                flow, state, hold_reason, owner_id, created_by, updated_at)
          select app.uuid_v7(), so.entity_id, replace(so.so_no, 'SO/', 'PRJ/'), '2098-99', so.id, so.account_id,
                 (array['farmer_pumps', 'residential_rooftop', 'commercial_epc'])[1 + g % 3], 'none', 'standard',
                 case when g % 10 = 0 then 'on_hold' when g % 7 = 0 then 'completed' else 'active' end,
                 case when g % 10 = 0 then 'plan' end,
                 case when g % 4 = 0 then ${manager}::uuid end, ${manager},
                 now() - make_interval(mins => g::int)
            from (select so.*, row_number() over (order by so.so_no) as g
                    from sales_orders so where so.entity_id = ${Number(entity)} and so.so_no like ${`${PREFIX}%`}) so`;
      }
      await tx`
        insert into project_milestones (id, entity_id, project_id, position, key, state, done_at, done_by)
        select app.uuid_v7(), p.entity_id, p.id, s.pos, s.key,
               case when s.pos <= (abs(hashtext(p.id::text)) % 5) then 'done' else 'open' end,
               case when s.pos <= (abs(hashtext(p.id::text)) % 5) then now() end,
               case when s.pos <= (abs(hashtext(p.id::text)) % 5) then ${manager}::uuid end
          from projects p
          cross join (values (1, 'survey'), (2, 'dispatch'), (3, 'install'), (4, 'commission'), (5, 'handover'))
                as s(pos, key)
         where p.project_no like ${`${PREFIX}%`}`;
      await tx`
        insert into project_assignments (id, entity_id, project_id, person_id, created_by)
        select app.uuid_v7(), p.entity_id, p.id, pe.id, ${manager}
          from (select p.*, row_number() over (order by p.id) as g from projects p
                 where p.project_no like ${`${PREFIX}%`}) p
          join (select id, row_number() over (order by id) - 1 as n from principals
                 where display_name like 'PJX person %') pe
            on pe.n in (p.g % ${PEOPLE}, (p.g * 7) % ${PEOPLE})
        on conflict do nothing`;
      await tx`
        insert into project_assignments (id, entity_id, project_id, person_id, created_by)
        select app.uuid_v7(), p.entity_id, p.id, ${engineer}, ${manager}
          from projects p
         where p.entity_id = 1 and p.project_no like ${`${PREFIX}%`}
         order by p.id
         limit 12`;
    }),
  );
  await asMigrator(async (m) => {
    for (const table of ['projects', 'project_milestones', 'project_assignments', 'sales_orders']) {
      await m.unsafe(`analyze ${table}`);
    }
  });
}

async function remove(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const projects = tx`select id from projects where project_no like ${`${PREFIX}%`}`;
      await tx`delete from project_assignments where project_id in (${projects})`;
      await tx`delete from project_milestones where project_id in (${projects})`;
      await tx`delete from projects where project_no like ${`${PREFIX}%`}`;
      await tx`delete from sales_orders where so_no like ${`${PREFIX}%`}`;
      await tx`delete from principals where display_name like 'PJX person %'`;
      await tx`delete from accounts where name = 'Plan customer'`;
    }),
  );
}

async function main(): Promise<void> {
  await prepareDatabase();
  const engineer = await createTestPrincipal('field_engineer', [1]);
  const manager = await createTestPrincipal('project_manager', [1]);
  await seed(engineer.id, manager.id);
  const [counts] = await asMigrator(
    (m) => m<{ projects: number; milestones: number; assignments: number }[]>`
      select (select count(*)::int from projects) as projects,
             (select count(*)::int from project_milestones) as milestones,
             (select count(*)::int from project_assignments) as assignments`,
  );
  process.stdout.write(`\nrows: ${JSON.stringify(counts)}\n`);
  await explain('Field Engineer, first page of company 1', engineer, { entityId: 1, limit: 50 });
  await explain('Field Engineer, active projects at the install step', engineer, {
    entityId: 1,
    state: 'active',
    step: 'install',
    limit: 50,
  });
  await explain('Project Manager, first page of company 1', manager, { entityId: 1, limit: 50 });
  await explain('Project Manager, on hold', manager, { entityId: 1, state: 'on_hold', limit: 50 });
  await explain('Project Manager, own projects of a segment', manager, {
    entityId: 1,
    ownerId: manager.id,
    segment: 'farmer_pumps',
    limit: 50,
  });
  await explain('Project Manager, current step install', manager, {
    entityId: 1,
    step: 'install',
    limit: 50,
  });
  // The filters' owners (J1 review 1): the engineer's of their own projects, by id; the manager's
  // of the company.
  for (const [label, who] of [
    ['Field Engineer', engineer],
    ['Project Manager', manager],
  ] as const) {
    await asPrincipal(who, async (ctx) => {
      const only = hasGrant(who.permissions, 'projects.read', 'entity')
        ? undefined
        : await ownProjectIds(ctx, 1);
      const rows = (await ctx.tx.execute(
        sql`explain (analyze, buffers, costs off) ${projectOwnersQuery(ctx, 1, only)}`,
      )) as unknown as Record<string, string>[];
      process.stdout.write(
        `\n=== ${label}, the filters' owners ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`,
      );
    });
  }
  // The own predicate over the whole company, as the policy alone would run it.
  await asPrincipal(engineer, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`explain (analyze, buffers, costs off) select count(*) from projects where entity_id = 1`,
    )) as unknown as Record<string, string>[];
    process.stdout.write(
      `\n=== Field Engineer, every project of company 1 under the policy alone ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`,
    );
  });
  await asPrincipal(engineer, async ({ tx }) => {
    const ids = (await tx.execute(
      sql`select id from projects where entity_id = 1 order by updated_at desc limit 50`,
    )) as unknown as { id: string }[];
    const rows = (await tx.execute(
      sql`explain (analyze, buffers, costs off)
          select * from app.project_customers(${`{${ids.map((r) => r.id).join(',')}}`}::uuid[])`,
    )) as unknown as Record<string, string>[];
    process.stdout.write(
      `\n=== the customers of a page (app.project_customers) ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`,
    );
  });
  await remove();
  await closeDb();
}

await main();
