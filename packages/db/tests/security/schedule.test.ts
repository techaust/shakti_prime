// J5 scheduling board (docs/03-roadmap-appendix/phase4.md §7.2, PRD PRJ-04): a visit is read with
// projects.read for the company or by a scheduler, and at `own` scope by the person on it (its
// engineer or a member of its crew); time away by the schedulers and the person themselves. A
// scheduler or the Orchestrator proposes; only a person changes a visit afterwards, and the person
// on a confirmed visit only records it done. app.schedule_busy() tells a scheduler when the people
// of the request's companies are busy in every company, never where another company's visit is.
// The visits use the role × company fixture's project and step of companies 1 and 2.
import { AGENT_PRINCIPAL_IDS, newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  asMigrator,
  closeDb,
  createTestUser,
  ENTITY_MATRIX_FIXTURE_PREFIX,
  entityMatrixFixture,
  principalFor,
  removeEntityMatrixFixture,
  withoutContext,
} from '../../src/testing/index';

const P = '01990000-0000-7000-8000-0000000c';
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;
const like = `${P}%`;
const fixture = (e: number, offset: number): string =>
  `${ENTITY_MATRIX_FIXTURE_PREFIX}${((e << 8) | offset).toString(16).padStart(4, '0')}`;
/** The matrix fixture's project of a company, and its one step. */
const project = (e: number) => fixture(e, 0x90);
const step = (e: number) => fixture(e, 0x92);

/** Engineer A's visit in company 1, engineer B's crew's visit, and a visit of company 2. */
const SLOT_A = id(0x0001);
const SLOT_CREW = id(0x0002);
const SLOT_OTHER_COMPANY = id(0x0003);
const CREW = id(0x0010);
const CREW_MEMBER = id(0x0011);
const AWAY_A = id(0x0020);
const AWAY_B = id(0x0021);

let manager: Principal;
let engineerA: Principal;
let engineerB: Principal;
/** An engineer of both companies: their company 2 visit is busy time for company 1. */
let bothEngineer: Principal;
const orchestrator = principalFor('agent:orchestrator', [1], {
  id: AGENT_PRINCIPAL_IDS['agent:orchestrator'],
});

async function removeRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from schedule_slots where id::text like ${like}
                 or project_id in (${project(1)}, ${project(2)})`;
      await tx`delete from crew_members where crew_id::text like ${like}`;
      await tx`delete from crews where id::text like ${like}`;
      await tx`delete from unavailability where id::text like ${like}`;
    }),
  );
}

beforeAll(async () => {
  await removeRows();
  await entityMatrixFixture();
  const person = async (role: 'project_manager' | 'field_engineer', entities: number[]) => {
    const user = await createTestUser(
      entities.map((entityId) => ({ entityId, roleKey: role })),
      { name: `schedule suite ${role}` },
    );
    return principalFor(role, [entities[0] ?? 1], { id: user.id });
  };
  manager = await person('project_manager', [1]);
  engineerA = await person('field_engineer', [1]);
  engineerB = await person('field_engineer', [1]);
  bothEngineer = await person('field_engineer', [1, 2]);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into crews (id, entity_id, name, lead_id, created_by)
        values (${CREW}, 1, 'schedule suite crew', ${engineerB.id}, ${manager.id})`;
      await tx`insert into crew_members (id, entity_id, crew_id, person_id, created_by)
        values (${CREW_MEMBER}, 1, ${CREW}, ${engineerB.id}, ${manager.id})`;
      await tx`insert into schedule_slots (id, entity_id, project_id, milestone_id, engineer_id, crew_id,
                 starts_at, ends_at, state, confirmed_at, confirmed_by, proposed_by, created_by) values
        (${SLOT_A}, 1, ${project(1)}, ${step(1)}, ${engineerA.id}, null, now() - interval '1 hour',
         now() + interval '1 hour', 'confirmed', now(), ${manager.id}, ${manager.id}, ${manager.id}),
        (${SLOT_CREW}, 1, ${project(1)}, ${step(1)}, null, ${CREW}, now() - interval '1 hour',
         now() + interval '1 hour', 'confirmed', now(), ${manager.id}, ${manager.id}, ${manager.id}),
        (${SLOT_OTHER_COMPANY}, 2, ${project(2)}, ${step(2)}, ${bothEngineer.id}, null,
         '2098-07-01T04:00:00Z', '2098-07-01T06:00:00Z', 'proposed', null, null, ${manager.id}, ${manager.id})`;
      await tx`insert into unavailability (id, entity_id, person_id, starts_at, ends_at, kind, created_by) values
        (${AWAY_A}, 1, ${engineerA.id}, '2098-07-01T00:00:00Z', '2098-07-02T00:00:00Z', 'leave', ${manager.id}),
        (${AWAY_B}, 1, ${engineerB.id}, '2098-07-01T00:00:00Z', '2098-07-02T00:00:00Z', 'training', ${manager.id})`;
    }),
  );
});

afterAll(async () => {
  await removeRows();
  await removeEntityMatrixFixture();
  await closeDb();
});

type Pool = 'app_user' | 'app_reader';
const POOLS: Pool[] = ['app_user', 'app_reader'];

/** This suite's ids of `table` that `principal` reads, on the given pool. */
async function visible(
  principal: Principal,
  table: 'schedule_slots' | 'unavailability' | 'crews',
  pool: Pool,
): Promise<string[]> {
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

/** Thrown to roll a trial back once its statements ran. */
class RolledBack extends Error {
  constructor(readonly rows: number) {
    super('rolled back');
  }
}

/**
 * Runs the statements as `principal` on app_user in one transaction and rolls it back: the rows
 * the last one touched, or the error that refused one.
 */
async function trial(principal: Principal, statements: SQL[]): Promise<number | Error> {
  try {
    await withRequestContext(principal, {}, async ({ tx }) => {
      let rows = 0;
      for (const statement of statements) {
        rows = ((await tx.execute(statement)) as unknown as unknown[]).length;
      }
      throw new RolledBack(rows);
    });
    throw new Error('unreachable');
  } catch (e) {
    if (e instanceof RolledBack) return e.rows;
    if (e instanceof Error && e.cause instanceof RolledBack) return e.cause.rows;
    if (e instanceof Error) return e;
    throw e;
  }
}

const causeOf = (e: number | Error): Error & { code?: string; constraint_name?: string } =>
  (e instanceof Error && e.cause instanceof Error ? e.cause : e) as Error & {
    code?: string;
    constraint_name?: string;
  };

describe('reads', () => {
  it('a Field Engineer reads the visits they are on, as engineer or crew member, on both pools', async () => {
    for (const pool of POOLS) {
      expect(await visible(engineerA, 'schedule_slots', pool)).toEqual([SLOT_A]);
      expect(await visible(engineerB, 'schedule_slots', pool)).toEqual([SLOT_CREW]);
      // Their company 2 visit, acting in company 1, is out of the request.
      expect(await visible(bothEngineer, 'schedule_slots', pool)).toEqual([]);
    }
  });

  it("a scheduler reads the company's visits, crews and time away; nobody reads without a context", async () => {
    for (const pool of POOLS) {
      expect(await visible(manager, 'schedule_slots', pool)).toEqual([SLOT_A, SLOT_CREW]);
      expect(await visible(manager, 'unavailability', pool)).toEqual([AWAY_A, AWAY_B]);
      expect(await visible(manager, 'crews', pool)).toEqual([CREW]);
    }
    for (const table of ['schedule_slots', 'unavailability', 'crews', 'crew_members']) {
      const rows = await withoutContext<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: 0 });
    }
  });

  it('a person reads their own time away, never a colleague’s', async () => {
    for (const pool of POOLS) {
      expect(await visible(engineerA, 'unavailability', pool)).toEqual([AWAY_A]);
      expect(await visible(engineerB, 'unavailability', pool)).toEqual([AWAY_B]);
    }
  });
});

describe('writes', () => {
  const slot = (state: string, extra: SQL = sql``) => sql`
    insert into schedule_slots (id, entity_id, project_id, milestone_id, engineer_id, starts_at, ends_at,
      state, proposed_by, created_by ${extra})
    values (${newId()}, 1, ${project(1)}, ${step(1)}, ${engineerA.id}, '2098-08-01T04:00:00Z',
      '2098-08-01T05:00:00Z', ${state}, (select app.user_id()), (select app.user_id()))
    returning id`;

  it('a scheduler and the Orchestrator propose; neither books straight away; an engineer proposes nothing', async () => {
    expect(await trial(manager, [slot('proposed')])).toBe(1);
    expect(await trial(orchestrator, [slot('proposed')])).toBe(1);
    expect(causeOf(await trial(manager, [slot('confirmed')])).message).toContain(
      'row-level security',
    );
    expect(causeOf(await trial(engineerA, [slot('proposed')])).message).toContain(
      'row-level security',
    );
  });

  it('only a person changes a visit after its proposal, so an agent never confirms', async () => {
    const confirm = sql`update schedule_slots set state = 'confirmed', confirmed_at = now(),
      confirmed_by = (select app.user_id()) where id = ${SLOT_OTHER_COMPANY} returning id`;
    const agentIn2 = principalFor('agent:orchestrator', [2], {
      id: AGENT_PRINCIPAL_IDS['agent:orchestrator'],
    });
    expect(causeOf(await trial(agentIn2, [confirm])).code).toBe('42501');
    const managerIn2 = await createTestUser([{ entityId: 2, roleKey: 'project_manager' }]);
    const person = principalFor('project_manager', [2], { id: managerIn2.id });
    expect(await trial(person, [confirm])).toBe(1);
    // A confirmation names the person confirming it.
    expect(
      causeOf(
        await trial(person, [
          sql`update schedule_slots set state = 'confirmed', confirmed_at = now(),
                confirmed_by = ${manager.id} where id = ${SLOT_OTHER_COMPANY}`,
        ]),
      ).code,
    ).toBe('42501');
  });

  it('the person on a confirmed visit records it done as themselves, and changes nothing else', async () => {
    const done = (slotId: string, by: string) => sql`
      update schedule_slots set state = 'done', done_at = now(), done_by = ${by}, done_note = 'schedule suite'
       where id = ${slotId} returning id`;
    expect(await trial(engineerA, [done(SLOT_A, engineerA.id)])).toBe(1);
    expect(await trial(engineerB, [done(SLOT_CREW, engineerB.id)])).toBe(1);
    // Not a visit they are on.
    expect(await trial(engineerA, [done(SLOT_CREW, engineerA.id)])).toBe(0);
    for (const refused of [
      done(SLOT_A, manager.id),
      sql`update schedule_slots set starts_at = starts_at + interval '1 hour' where id = ${SLOT_A}`,
      sql`update schedule_slots set state = 'cancelled', cancel_reason = 'schedule suite' where id = ${SLOT_A}`,
      sql`update schedule_slots set state = 'done', done_at = now(), done_by = ${engineerA.id},
            ends_at = ends_at + interval '1 hour' where id = ${SLOT_A}`,
    ]) {
      expect(causeOf(await trial(engineerA, [refused])).code).toBe('42501');
    }
  });

  it("holds a visit's step to its project, its engineer and a crew's people to the company", async () => {
    const outside = await createTestUser([{ entityId: 2, roleKey: 'field_engineer' }]);
    const refusals: [SQL, string][] = [
      [
        sql`insert into schedule_slots (id, entity_id, project_id, milestone_id, engineer_id, starts_at, ends_at,
              proposed_by, created_by)
            values (${newId()}, 1, ${project(1)}, ${step(2)}, ${engineerA.id}, '2098-08-01T04:00:00Z',
              '2098-08-01T05:00:00Z', ${manager.id}, ${manager.id})`,
        'schedule_slot_milestone_outside',
      ],
      [
        sql`insert into schedule_slots (id, entity_id, project_id, milestone_id, engineer_id, starts_at, ends_at,
              proposed_by, created_by)
            values (${newId()}, 1, ${project(1)}, ${step(1)}, ${outside.id}, '2098-08-01T04:00:00Z',
              '2098-08-01T05:00:00Z', ${manager.id}, ${manager.id})`,
        'schedule_slot_person_outside',
      ],
      [
        sql`insert into crew_members (id, entity_id, crew_id, person_id, created_by)
            values (${newId()}, 1, ${CREW}, ${outside.id}, ${manager.id})`,
        'crew_person_outside',
      ],
      [
        sql`insert into unavailability (id, entity_id, person_id, starts_at, ends_at, kind, created_by)
            values (${newId()}, 1, ${outside.id}, '2098-08-01T00:00:00Z', '2098-08-02T00:00:00Z', 'leave',
              ${manager.id})`,
        'unavailability_person_outside',
      ],
    ];
    for (const [statement, constraint] of refusals) {
      expect({
        constraint,
        got: causeOf(await trial(manager, [statement])).constraint_name,
      }).toEqual({
        constraint,
        got: constraint,
      });
    }
  });

  it('an engineer records no time away and no crew', async () => {
    for (const statement of [
      sql`insert into unavailability (id, entity_id, person_id, starts_at, ends_at, kind, created_by)
          values (${newId()}, 1, ${engineerA.id}, '2098-08-01T00:00:00Z', '2098-08-02T00:00:00Z', 'leave',
            ${engineerA.id})`,
      sql`insert into crews (id, entity_id, name, lead_id, created_by)
          values (${newId()}, 1, 'schedule suite', ${engineerA.id}, ${engineerA.id})`,
      sql`delete from unavailability where id = ${AWAY_A} returning id`,
    ]) {
      const result = await trial(engineerA, [statement]);
      expect(result === 0 || causeOf(result).message.includes('row-level security')).toBe(true);
    }
  });
});

describe('app.schedule_busy()', () => {
  type Busy = {
    person_id: string;
    kind: string;
    item_id: string;
    entity_id: number;
    lat: string | null;
  };
  const busy = (who: Principal, people: string[], from: string, to: string) =>
    withRequestContext(
      who,
      {},
      async ({ tx }) =>
        (await tx.execute(
          sql`select person_id::text as person_id, kind, item_id::text as item_id, entity_id, lat::text as lat
              from app.schedule_busy(${`{${people.join(',')}}`}::uuid[], ${from}::timestamptz, ${to}::timestamptz)
             order by item_id`,
        )) as unknown as Busy[],
    );

  it("tells a scheduler another company's visit of their person, when and never where", async () => {
    expect(
      await busy(
        manager,
        [bothEngineer.id, engineerA.id],
        '2098-06-30T00:00:00Z',
        '2098-07-03T00:00:00Z',
      ),
    ).toEqual([
      {
        person_id: bothEngineer.id,
        kind: 'slot',
        item_id: SLOT_OTHER_COMPANY,
        entity_id: 2,
        lat: null,
      },
      { person_id: engineerA.id, kind: 'away', item_id: AWAY_A, entity_id: 1, lat: null },
    ]);
  });

  it('answers each crew member for a crew visit, and nothing for a person outside the companies', async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + 86_400_000).toISOString();
    const outside = await createTestUser([{ entityId: 3, roleKey: 'field_engineer' }]);
    expect(
      (await busy(manager, [engineerB.id, outside.id], from, to)).map((r) => [
        r.person_id,
        r.item_id,
      ]),
    ).toEqual([[engineerB.id, SLOT_CREW]]);
  });

  it('is refused to an engineer, and to a window over 15 days', async () => {
    const refused = (who: Principal, to: string) =>
      busy(who, [engineerA.id], '2098-07-01T00:00:00Z', to).then(
        () => 'answered',
        (e: unknown) => causeOf(e as Error).code,
      );
    expect(await refused(engineerA, '2098-07-02T00:00:00Z')).toBe('42501');
    expect(await refused(manager, '2098-07-17T00:00:00Z')).toBe('22023');
  });
});
