// J6 QC checklists, inspections and project cost lines (docs/03-roadmap-appendix/phase4.md §7.3,
// PRD PRJ-05 and PRJ-02's QC step). Over the role × company fixture's rows of each company (its
// owner's project with one step, the step's checklist, an inspection the second person submitted
// and a labour charge): a cost line is read only with finance.cost.read for the company, on both
// pools, by no agent; a checklist and an inspection with projects.read; cost lines never change and
// a reversal mirrors its line; the signer is never the submitter; a step with a checklist is done
// only once its inspection is signed off; the QC photo's file purpose.
import { hasGrant, newId, type Principal, ROLE_KEYS, type RoleKey } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  ALL_ENTITY_IDS,
  closeDb,
  ENTITY_MATRIX_FIXTURE_PREFIX,
  entityMatrixFixture,
  principalFor,
  removeEntityMatrixFixture,
  withoutContext,
} from '../../src/testing/index';

const P = ENTITY_MATRIX_FIXTURE_PREFIX;
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;
const per = (e: number, offset: number): string => id((e << 8) | offset);
/** The fixture's owner of every project, and the person on it who submitted the inspection. */
const OWNER = id(0x0001);
const SUBMITTER = id(0x0007);
const project = (e: number) => per(e, 0x90);
const step = (e: number) => per(e, 0x92);
const checklist = (e: number) => per(e, 0xa0);
const inspection = (e: number) => per(e, 0xa1);
const costLine = (e: number) => per(e, 0xa2);

const TABLES = ['checklists', 'qc_inspections', 'project_cost_lines'] as const;
type Table = (typeof TABLES)[number];
const ROW: Record<Table, (e: number) => string> = {
  checklists: checklist,
  qc_inspections: inspection,
  project_cost_lines: costLine,
};

beforeAll(async () => {
  await removeEntityMatrixFixture();
  await entityMatrixFixture();
});

afterAll(async () => {
  await removeEntityMatrixFixture();
  await closeDb();
});

type Pool = 'app_user' | 'app_reader';
const POOLS: Pool[] = ['app_user', 'app_reader'];

async function visible(principal: Principal, table: Table, pool: Pool): Promise<string[]> {
  return withRequestContext(
    principal,
    {},
    async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select id::text as id from ${sql.identifier(table)} where id::text like ${`${P}%`} order by id`,
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

const causeOf = (e: number | Error): string =>
  e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : '';

const actingAs = (role: RoleKey, e: number, who = OWNER): Principal =>
  principalFor(role, [e], { id: who });

describe('every role acting in one company reads only what its grants allow, on both pools', () => {
  describe.each(ROLE_KEYS)('%s', (role) => {
    it.each(ALL_ENTITY_IDS)('acting in company %i', async (e) => {
      const grants = principalFor(role).permissions;
      // The fixture acts as the project's owner, so `own` reads the project.
      const readsProject = hasGrant(grants, 'projects.read', 'own');
      const want: Record<Table, string[]> = {
        checklists: readsProject ? [checklist(e)] : [],
        qc_inspections: readsProject ? [inspection(e)] : [],
        project_cost_lines:
          readsProject && hasGrant(grants, 'finance.cost.read', 'entity') ? [costLine(e)] : [],
      };
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

  it('only the Executive and Accounts read a cost line, and no agent', () => {
    const readers = ROLE_KEYS.filter((r) =>
      hasGrant(principalFor(r).permissions, 'finance.cost.read', 'entity'),
    );
    expect(readers.sort()).toEqual(['accounts', 'executive']);
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

describe('project_cost_lines: restricted and append-only', () => {
  const insertLine = (e: number, extra: SQL = sql``) =>
    sql`insert into project_cost_lines (id, entity_id, project_id, kind, quantity, rate, amount, created_by ${extra})
        values (${newId()}, ${e}, ${project(e)}, 'labour', 2, 500.00, 1000.00, ${OWNER}) returning id`;

  it('is written by a person with finance.cost.read who also writes the project', async () => {
    expect(await trial(actingAs('executive', 1), [insertLine(1)])).toBe(1);
    // Accounts reads costs but writes no project; a Project Manager writes it but reads no cost.
    for (const role of ['accounts', 'project_manager', 'field_engineer'] as const) {
      expect(causeOf(await trial(actingAs(role, 1), [insertLine(1)]))).toContain(
        'row-level security',
      );
    }
    // Not as someone else (here a caller who is no person on record), nor in another company.
    expect(causeOf(await trial(actingAs('executive', 1, newId()), [insertLine(1)]))).toMatch(
      /row-level security|only a person/,
    );
    expect(causeOf(await trial(actingAs('executive', 2), [insertLine(1)]))).toContain(
      'row-level security',
    );
  });

  it('never changes and is never removed, by anyone', async () => {
    for (const statement of [
      sql`update project_cost_lines set rate = 1 where id = ${costLine(1)} returning id`,
      sql`delete from project_cost_lines where id = ${costLine(1)} returning id`,
    ]) {
      expect(causeOf(await trial(actingAs('executive', 1), [statement]))).toContain(
        'permission denied',
      );
    }
  });

  it('a reversal mirrors its line, once; a reversal is not reversed', async () => {
    const reverse = (quantity: number, rate: number, of = costLine(1)) =>
      sql`insert into project_cost_lines (id, entity_id, project_id, kind, quantity, rate, amount, reverses_id, created_by)
          values (${newId()}, 1, ${project(1)}, 'labour', ${quantity}, ${rate}, round(${quantity}::numeric * ${rate}, 2),
                  ${of}, ${OWNER}) returning id`;
    const executive = actingAs('executive', 1);
    expect(await trial(executive, [reverse(-1, 100)])).toBe(1);
    expect(causeOf(await trial(executive, [reverse(-2, 100)]))).toContain('mirrors');
    expect(causeOf(await trial(executive, [reverse(-1, 90)]))).toContain('mirrors');
    expect(causeOf(await trial(executive, [reverse(-1, 100), reverse(-1, 100)]))).toContain(
      'project_cost_lines_reverses_unique',
    );
  });

  it('a contractor’s charge names an active vendor of kind contractor', async () => {
    const vendor = newId();
    const line = () =>
      sql`insert into project_cost_lines (id, entity_id, project_id, kind, vendor_id, quantity, rate, amount, created_by)
          values (${newId()}, 1, ${project(1)}, 'contractor', ${vendor}, 1, 100.00, 100.00, ${OWNER}) returning id`;
    const executive = actingAs('executive', 1);
    const vendorOf = (kind: string) =>
      sql`insert into vendors (id, name, kind, created_by) values (${vendor}, 'qc security vendor', ${kind}, ${OWNER}) returning id`;
    expect(await trial(executive, [vendorOf('contractor'), line()])).toBe(1);
    expect(causeOf(await trial(executive, [vendorOf('supplier'), line()]))).toContain(
      'no active contractor',
    );
  });
});

describe('qc_inspections: decided once, never by the submitter', () => {
  const decide = (e: number, state: string, who: string) =>
    sql`update qc_inspections set state = ${state}, decided_at = now(), decided_by = ${who},
          reject_reason = ${state === 'rejected' ? 'Retake the photo' : null}
        where id = ${inspection(e)} returning id`;

  it('a holder of projects.qc.signoff signs off or turns down; the submitter cannot', async () => {
    expect(await trial(actingAs('project_manager', 1), [decide(1, 'signed_off', OWNER)])).toBe(1);
    expect(await trial(actingAs('general_manager', 1), [decide(1, 'rejected', OWNER)])).toBe(1);
    expect(
      causeOf(
        await trial(actingAs('project_manager', 1, SUBMITTER), [
          decide(1, 'signed_off', SUBMITTER),
        ]),
      ),
    ).toContain('qc_inspections_signer_check');
    // Without the grant the row is not there to decide.
    expect(await trial(actingAs('field_engineer', 1), [decide(1, 'signed_off', OWNER)])).toBe(0);
    expect(await trial(actingAs('accounts', 1), [decide(1, 'signed_off', OWNER)])).toBe(0);
  });

  it('a decided inspection changes no more, and its answers never change', async () => {
    const manager = actingAs('project_manager', 1);
    expect(
      await trial(manager, [decide(1, 'signed_off', OWNER), decide(1, 'rejected', OWNER)]),
    ).toBe(0);
    expect(
      causeOf(
        await trial(manager, [
          sql`update qc_inspections set answers_json = '[]'::jsonb where id = ${inspection(1)} returning id`,
        ]),
      ),
    ).toContain('permission denied');
    expect(
      causeOf(
        await trial(manager, [
          sql`delete from qc_inspections where id = ${inspection(1)} returning id`,
        ]),
      ),
    ).toContain('permission denied');
  });

  it('is submitted on an open step with a checklist, by whoever writes the project, as themselves', async () => {
    const insert = (who: string) =>
      sql`insert into qc_inspections (id, entity_id, project_id, milestone_id, checklist_id, answers_json,
                 submitted_at, submitted_by)
          values (${newId()}, 1, ${project(1)}, ${step(1)}, ${checklist(1)}, '[]'::jsonb, now(), ${who})
          returning id`;
    // One waits already.
    expect(causeOf(await trial(actingAs('project_manager', 1), [insert(OWNER)]))).toContain(
      'qc_inspections_milestone_live_unique',
    );
    const turnedDown = decide(1, 'rejected', OWNER);
    expect(await trial(actingAs('project_manager', 1), [turnedDown, insert(OWNER)])).toBe(1);
    for (const role of ['accounts', 'tele_caller_cc'] as const) {
      expect(causeOf(await trial(actingAs(role, 1), [insert(OWNER)]))).toContain(
        'row-level security',
      );
    }
    expect(
      causeOf(await trial(actingAs('project_manager', 1), [turnedDown, insert(newId())])),
    ).toContain('row-level security');
    // An agent writes no inspection, whatever it holds.
    expect(
      causeOf(await trial(actingAs('agent:orchestrator', 1), [turnedDown, insert(OWNER)])),
    ).toMatch(/row-level security|only a person/);
  });
});

describe('a step with a checklist is done only once its inspection is signed off', () => {
  const done = (e: number) =>
    sql`update project_milestones set state = 'done', done_at = now(), done_by = ${OWNER}
        where id = ${step(e)} returning id`;
  const ask = (who: Principal, e: number) =>
    withRequestContext(who, {}, async ({ tx }) => {
      const [row] = (await tx.execute(
        sql`select app.project_qc_signed_off(${project(e)}::uuid, 'survey') as ok`,
      )) as unknown as { ok: boolean }[];
      return row?.ok;
    });

  it('app.project_qc_signed_off() answers for the step, in the request’s companies only', async () => {
    expect(await ask(actingAs('project_manager', 1), 1)).toBe(false);
    expect(await ask(actingAs('project_manager', 2), 1)).toBe(false);
    await expect(ask(actingAs('tele_caller_cc', 1), 1)).rejects.toThrow();
  });

  it('the database refuses the step until the check is signed off', async () => {
    const manager = actingAs('project_manager', 1);
    expect(causeOf(await trial(manager, [done(1)]))).toContain('quality check');
    expect(await trial(manager, [sql`
      update qc_inspections set state = 'signed_off', decided_at = now(), decided_by = ${OWNER}
       where id = ${inspection(1)} returning id`, done(1)])).toBe(1);
  });
});

describe('the QC photo', () => {
  it('is uploaded by whoever writes a project and read with projects.read', async () => {
    const [row] = await withoutContext<{ w: string; r: string }>(
      sql`select app.file_purpose_grant('qc_photo', 'write') as w, app.file_purpose_grant('qc_photo', 'read') as r`,
    );
    expect(row).toEqual({ w: 'projects.write:own', r: 'projects.read' });
  });
});
