// J1 projects (docs/03-roadmap-appendix/phase4.md §5, §6.1): a project is read with projects.read
// for the company, or at `own` scope when the caller owns it or is assigned to it
// (app.project_is_mine()); its steps and people are read with it; the company's checklists by any
// holder of projects.read. Every read runs on both pools, app_user and app_reader, for every role
// acting in every company; the writes run as app_user under real row security.
import { hasGrant, newId, type Principal, ROLE_KEYS, type RoleKey } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  ALL_ENTITY_IDS,
  asMigrator,
  closeDb,
  ENTITY_MATRIX_FIXTURE_PREFIX,
  entityMatrixFixture,
  principalFor,
  removeEntityMatrixFixture,
  withoutContext,
} from '../../src/testing/index';

const P = '01990000-0000-7000-8000-0000000e';
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;
const like = `${P}%`;

/** The Project Manager who owns every project A. */
const MANAGER = id(0x0001);
/** The Field Engineer on every project A, and on no project B. */
const ENGINEER = id(0x0002);
/** The Lead Converter who owns every project B. */
const CONVERTER = id(0x0003);
/** A project A of each company: on its dealer order, owned by the manager, the engineer on it. */
const projectA = (e: number): string => id(0x0100 | e);
/** A project B of each company: on its lead's order, cancelled, owned by the converter. */
const projectB = (e: number): string => id(0x0200 | e);
const stepA = (e: number): string => id(0x0300 | e);
const stepB = (e: number): string => id(0x0400 | e);
const assignmentA = (e: number): string => id(0x0500 | e);
const templateOf = (e: number): string => id(0x0600 | e);

const TABLES = [
  'projects',
  'project_milestones',
  'project_assignments',
  'project_flow_templates',
] as const;
type Table = (typeof TABLES)[number];

async function removeFixture(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from project_assignments where id::text like ${like} or project_id::text like ${like}`;
      await tx`delete from project_milestones where id::text like ${like} or project_id::text like ${like}`;
      await tx`delete from projects where id::text like ${like}`;
      await tx`alter table project_flow_templates disable trigger project_flow_templates_append_only`;
      await tx`delete from project_flow_templates where id::text like ${like}`;
      await tx`alter table project_flow_templates enable trigger project_flow_templates_append_only`;
    }),
  );
}

/** The matrix fixture's orders of a company: its lead's and its dealer's. */
async function ordersOf(e: number): Promise<{ lead: string; dealer: string }> {
  const rows = await asMigrator(
    (m) =>
      m<{ id: string; quote_id: string | null }[]>`
      select id::text as id, quote_id from sales_orders
       where entity_id = ${e} and id::text like ${`${ENTITY_MATRIX_FIXTURE_PREFIX}%`}`,
  );
  const lead = rows.find((r) => r.quote_id !== null)?.id;
  const dealer = rows.find((r) => r.quote_id === null)?.id;
  if (lead === undefined || dealer === undefined) throw new Error(`no fixture orders in ${e}`);
  return { lead, dealer };
}

beforeAll(async () => {
  await removeFixture();
  await entityMatrixFixture();
  const orders = new Map<number, { lead: string; dealer: string }>();
  for (const e of ALL_ENTITY_IDS) orders.set(e, await ordersOf(e));
  await asMigrator((m) =>
    m.begin(async (tx) => {
      for (const [who, name] of [
        [MANAGER, 'projects suite manager'],
        [ENGINEER, 'projects suite engineer'],
        [CONVERTER, 'projects suite converter'],
      ] as const) {
        await tx`insert into principals (id, kind, display_name)
          values (${who}, 'user', ${name}) on conflict (id) do nothing`;
      }
      for (const e of ALL_ENTITY_IDS) {
        const order = orders.get(e);
        if (!order) throw new Error('unreachable');
        await tx`insert into project_flow_templates (id, entity_id, segment, version, steps_json, published_by)
          values (${templateOf(e)}, ${e}, 'residential_rooftop', 9000,
                  '[{"key": "survey", "title": "projects suite step", "requires": []}]'::jsonb, ${MANAGER})`;
        await tx`insert into projects (id, entity_id, project_no, fy, sales_order_id, account_id, segment, scheme,
                   flow, owner_id, created_by)
          select ${projectA(e)}, ${e}, ${`PS${e.toString()}/PRJ/2098-99/0001`}, '2098-99', so.id, so.account_id,
                 'farmer_pumps', 'none', 'standard', ${MANAGER}, ${MANAGER}
            from sales_orders so where so.id = ${order.dealer}`;
        await tx`insert into projects (id, entity_id, project_no, fy, sales_order_id, account_id, segment, scheme,
                   flow, state, cancel_reason, owner_id, created_by)
          select ${projectB(e)}, ${e}, ${`PS${e.toString()}/PRJ/2098-99/0002`}, '2098-99', so.id, so.account_id,
                 'farmer_pumps', 'none', 'standard', 'cancelled', 'projects suite', ${CONVERTER}, ${MANAGER}
            from sales_orders so where so.id = ${order.lead}`;
        await tx`insert into project_milestones (id, entity_id, project_id, position, key, title) values
          (${stepA(e)}, ${e}, ${projectA(e)}, 1, 'survey', 'projects suite step'),
          (${stepB(e)}, ${e}, ${projectB(e)}, 1, 'survey', 'projects suite step')`;
        await tx`insert into project_assignments (id, entity_id, project_id, person_id, created_by)
          values (${assignmentA(e)}, ${e}, ${projectA(e)}, ${ENGINEER}, ${MANAGER})`;
      }
    }),
  );
});

afterAll(async () => {
  await removeFixture();
  await removeEntityMatrixFixture();
  await closeDb();
});

type Pool = 'app_user' | 'app_reader';
const POOLS: Pool[] = ['app_user', 'app_reader'];

/** The suite's ids of `table` that `principal` reads, on the given pool. */
async function visible(principal: Principal, table: Table, pool: Pool): Promise<string[]> {
  return withRequestContext(
    principal,
    {},
    async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select id::text as id from ${sql.identifier(table)} where id::text like ${like} order by id`,
      )) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    },
    { reader: pool === 'app_reader' },
  );
}

/** Rows a statement touched as `principal` on app_user, or the error that refused it. */
async function attempt(principal: Principal, statement: SQL): Promise<number | Error> {
  try {
    return await withRequestContext(principal, {}, async ({ tx }) => {
      const rows = (await tx.execute(statement)) as unknown as unknown[];
      return rows.length;
    });
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
}

const causeOf = (e: number | Error): string =>
  e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : '';
const codeOf = (e: number | Error): string | undefined =>
  e instanceof Error && e.cause instanceof Error
    ? (e.cause as Error & { code?: string }).code
    : undefined;

/** A role acting in one company, as the engineer (the person on every project A). */
const actingAs = (role: RoleKey, e: number, who = ENGINEER): Principal =>
  principalFor(role, [e], { id: who });

/** What a role acting as the engineer in company `e` should read of each table. */
function expected(role: RoleKey, e: number): Record<Table, string[]> {
  const grants = principalFor(role).permissions;
  const all = hasGrant(grants, 'projects.read', 'entity');
  const own = hasGrant(grants, 'projects.read', 'own');
  const sort = (ids: string[]) => [...ids].sort();
  return {
    projects: sort(all ? [projectA(e), projectB(e)] : own ? [projectA(e)] : []),
    project_milestones: sort(all ? [stepA(e), stepB(e)] : own ? [stepA(e)] : []),
    project_assignments: all || own ? [assignmentA(e)] : [],
    project_flow_templates: own ? [templateOf(e)] : [],
  };
}

describe('every role acting in one company reads only its projects, on both pools', () => {
  describe.each(ROLE_KEYS)('%s', (role) => {
    it.each(ALL_ENTITY_IDS)('acting in company %i', async (e) => {
      const want = expected(role, e);
      for (const pool of POOLS) {
        for (const table of TABLES) {
          expect({ pool, table, seen: await visible(actingAs(role, e), table, pool) }).toEqual({
            pool,
            table,
            seen: want[table],
          });
        }
      }
    });
  });

  it('reads nothing without a request context', async () => {
    for (const table of TABLES) {
      const rows = await withoutContext<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: 0 });
    }
  });
});

describe('the `own` scope: a project the caller owns or is assigned to (app.project_is_mine())', () => {
  it('a Field Engineer reads only the project they are on, its steps and its people', async () => {
    for (const pool of POOLS) {
      expect(await visible(actingAs('field_engineer', 1), 'projects', pool)).toEqual([projectA(1)]);
      expect(await visible(actingAs('field_engineer', 1), 'project_milestones', pool)).toEqual([
        stepA(1),
      ]);
    }
    // Another engineer, on no project, reads none.
    expect(await visible(actingAs('field_engineer', 1, newId()), 'projects', 'app_user')).toEqual(
      [],
    );
  });

  it('a Lead Converter reads the project they own, and not one they are not on', async () => {
    for (const pool of POOLS) {
      expect(await visible(actingAs('tele_caller_lc', 2, CONVERTER), 'projects', pool)).toEqual([
        projectB(2),
      ]);
    }
  });

  it('answers for the caller only, in the companies of the request', async () => {
    const ask = (who: Principal, project: string) =>
      withRequestContext(who, {}, async ({ tx }) => {
        const [row] = (await tx.execute(
          sql`select app.project_is_mine(${project}::uuid) as mine`,
        )) as unknown as { mine: boolean }[];
        return row?.mine;
      });
    expect(await ask(actingAs('field_engineer', 1), projectA(1))).toBe(true);
    expect(await ask(actingAs('field_engineer', 1), projectB(1))).toBe(false);
    // The engineer's project of company 1, asked acting in company 2.
    expect(await ask(actingAs('field_engineer', 2), projectA(1))).toBe(false);
    expect(await ask(actingAs('project_manager', 1, MANAGER), projectA(1))).toBe(true);
  });
});

describe('writes', () => {
  it('no request role makes a project or a step: app.create_project() does', async () => {
    const executive = principalFor('executive', [1], { id: MANAGER });
    for (const statement of [
      sql`insert into projects (id, entity_id, project_no, fy, sales_order_id, account_id, segment, scheme, flow, created_by)
          select ${newId()}, 1, 'X', '2098-99', sales_order_id, account_id, 'farmer_pumps', 'none', 'standard', ${MANAGER}
            from projects where id = ${projectA(1)}`,
      sql`insert into project_milestones (id, entity_id, project_id, position, key)
          values (${newId()}, 1, ${projectA(1)}, 9, 'extra')`,
    ]) {
      expect(causeOf(await attempt(executive, statement))).toContain('permission denied');
    }
  });

  it('a Field Engineer moves the project and the steps they are on, and no other', async () => {
    const engineer = actingAs('field_engineer', 1);
    expect(
      await attempt(
        engineer,
        sql`update projects set state_changed_at = now() where id = ${projectA(1)} returning id`,
      ),
    ).toBe(1);
    expect(
      await attempt(
        engineer,
        sql`update projects set state_changed_at = now() where id = ${projectB(1)} returning id`,
      ),
    ).toBe(0);
    expect(
      await attempt(
        engineer,
        sql`update project_milestones set skip_reason = null where id = ${stepA(1)} returning id`,
      ),
    ).toBe(1);
    expect(
      await attempt(
        engineer,
        sql`update project_milestones set skip_reason = null where id = ${stepB(1)} returning id`,
      ),
    ).toBe(0);
  });

  it('only a holder of projects.write for the company names the owner or changes the people', async () => {
    const engineer = actingAs('field_engineer', 1);
    const naming = await attempt(
      engineer,
      sql`update projects set owner_id = ${ENGINEER} where id = ${projectA(1)} returning id`,
    );
    expect(codeOf(naming)).toBe('42501');
    expect(
      causeOf(
        await attempt(
          engineer,
          sql`insert into project_assignments (id, entity_id, project_id, person_id, created_by)
              values (${newId()}, 1, ${projectA(1)}, ${CONVERTER}, ${ENGINEER})`,
        ),
      ),
    ).toContain('row-level security');
    const manager = actingAs('project_manager', 1, MANAGER);
    const extra = id(0x0701);
    expect(
      await attempt(
        manager,
        sql`insert into project_assignments (id, entity_id, project_id, person_id, created_by)
            values (${extra}, 1, ${projectA(1)}, ${CONVERTER}, ${MANAGER}) returning id`,
      ),
    ).toBe(1);
    // A person on a project of another company is refused: the project is not in the request.
    expect(
      causeOf(
        await attempt(
          manager,
          sql`insert into project_assignments (id, entity_id, project_id, person_id, created_by)
              values (${newId()}, 1, ${projectA(2)}, ${CONVERTER}, ${MANAGER})`,
        ),
      ),
    ).toMatch(/row-level security|foreign key/);
    expect(
      await attempt(manager, sql`delete from project_assignments where id = ${extra} returning id`),
    ).toBe(1);
    expect(
      await attempt(
        manager,
        sql`update projects set owner_id = ${MANAGER} where id = ${projectA(1)} returning id`,
      ),
    ).toBe(1);
  });

  it('only the Executive publishes a checklist, and a published one never changes', async () => {
    const publish = (who: Principal) =>
      attempt(
        who,
        sql`insert into project_flow_templates (id, entity_id, segment, version, steps_json, published_by)
            values (${newId()}, 1, 'residential_rooftop', 8000 + floor(random() * 900)::int,
                    '[{"key": "survey", "title": "projects suite step", "requires": []}]'::jsonb, ${who.id})
            returning id`,
      );
    expect(causeOf(await publish(principalFor('general_manager', [1], { id: MANAGER })))).toContain(
      'row-level security',
    );
    const executive = principalFor('executive', [1], { id: MANAGER });
    const published = await publish(executive);
    expect(published).toBe(1);
    for (const statement of [
      sql`update project_flow_templates set version = 9999 where id = ${templateOf(1)}`,
      sql`delete from project_flow_templates where id = ${templateOf(1)}`,
    ]) {
      expect(causeOf(await attempt(executive, statement))).toContain('permission denied');
    }
    // Remove the version this test published, so a later run starts from the fixture alone.
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`alter table project_flow_templates disable trigger project_flow_templates_append_only`;
        await tx`delete from project_flow_templates where entity_id = 1 and segment = 'residential_rooftop'
                   and version between 8000 and 8999`;
        await tx`alter table project_flow_templates enable trigger project_flow_templates_append_only`;
      }),
    );
  });
});

describe('the definers that make a project (ADR 0020)', () => {
  const facts = (who: Principal, order: string) =>
    attempt(who, sql`select * from app.project_order_facts(1::smallint, ${order}::uuid)`);

  it('read an order only for the platform drafting or a holder of projects.write for the company', async () => {
    const { dealer } = await ordersOf(1);
    expect(await facts(principalFor('system:workers', [1]), dealer)).toBe(1);
    expect(await facts(actingAs('project_manager', 1, MANAGER), dealer)).toBe(1);
    for (const role of [
      'field_engineer',
      'tele_caller_lc',
      'accounts',
      'agent:orchestrator',
    ] as const) {
      expect({ role, code: codeOf(await facts(actingAs(role, 1), dealer)) }).toEqual({
        role,
        code: '42501',
      });
    }
    // The platform acting in company 2 reads no order of company 1.
    expect(codeOf(await facts(principalFor('system:workers', [2]), dealer))).toBe('42501');
  });

  it('make a project only for the platform drafting or a person with projects.write for the company, never an agent', async () => {
    const { dealer } = await ordersOf(1);
    const make = (who: Principal) =>
      attempt(
        who,
        sql`select * from app.create_project(${newId()}::uuid, 1::smallint, ${dealer}::uuid, 'X', '2098-99',
                                             'farmer_pumps', 'none', null, '[]'::jsonb, true)`,
      );
    for (const role of [
      'field_engineer',
      'tele_caller_lc',
      'accounts',
      'agent:orchestrator',
    ] as const) {
      expect({ role, code: codeOf(await make(actingAs(role, 1))) }).toEqual({
        role,
        code: '42501',
      });
    }
  });

  it('keep projects.draft for the platform alone', async () => {
    const [row] = await withoutContext<{
      listed: boolean;
      staff: boolean;
      agent: boolean;
      system: boolean;
    }>(sql`
      select 'projects.draft' = any (app.platform_only_permissions()) as listed,
             app.role_may_hold('project_manager', 'projects.draft') as staff,
             app.role_may_hold('agent:orchestrator', 'projects.draft') as agent,
             app.role_may_hold('system:workers', 'projects.draft') as system
    `);
    expect(row).toEqual({ listed: true, staff: false, agent: false, system: true });
  });

  it('answer no missing document for any step until J3 lists them', async () => {
    const rows = await withRequestContext(
      actingAs('field_engineer', 1),
      {},
      async ({ tx }) =>
        (await tx.execute(
          sql`select * from app.project_missing_documents(${projectA(1)}::uuid, 'survey')`,
        )) as unknown as unknown[],
    );
    expect(rows).toEqual([]);
  });
});

describe('app.status_summary() adds the customer’s own projects with their current step (WA-03)', () => {
  it('lists the chat’s customer’s projects not cancelled, with the first open step, in the chat’s company only', async () => {
    const threads = await asMigrator(
      (m) =>
        m<{ id: string }[]>`
        select t.id::text as id from whatsapp_threads t
          join projects p on p.account_id = t.account_id and p.entity_id = t.entity_id
         where t.entity_id = 1 and p.id = ${projectA(1)}`,
    );
    const thread = threads[0]?.id;
    if (thread === undefined) throw new Error('no fixture chat');
    const workers = principalFor('system:workers', [1]);
    const lines = await withRequestContext(
      workers,
      {},
      async ({ tx }) =>
        (await tx.execute(
          sql`select kind, ref, state, step_key, step_title from app.status_summary(${thread}::uuid)
             where kind = 'project'`,
        )) as unknown as { ref: string; state: string; step_key: string | null }[],
    );
    const mine = lines.filter((l) => l.ref.startsWith('PS1/'));
    // Project A is active at its survey step; project B is cancelled and left out.
    expect(mine).toEqual([
      {
        kind: 'project',
        ref: 'PS1/PRJ/2098-99/0001',
        state: 'active',
        step_key: 'survey',
        step_title: 'projects suite step',
      },
    ]);
    expect(
      await withRequestContext(
        principalFor('system:workers', [2]),
        {},
        async ({ tx }) =>
          (await tx.execute(
            sql`select * from app.status_summary(${thread}::uuid)`,
          )) as unknown as unknown[],
      ),
    ).toEqual([]);
    expect(
      codeOf(
        await attempt(
          actingAs('project_manager', 1, MANAGER),
          sql`select * from app.status_summary(${thread}::uuid)`,
        ),
      ),
    ).toBe('42501');
  });
});
