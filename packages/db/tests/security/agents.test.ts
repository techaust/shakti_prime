import { AGENT_PRINCIPAL_IDS, newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  PLATFORM_TABLES,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// The agent runtime's tables under RLS (0093, docs/DATABASE.md §6.9): an agent writes its own runs,
// actions and inbox items and reads none of them back; people read the inbox at their
// agents.inbox.act scope and decide once; the agent controls read the runs and change the settings,
// autonomy and caps with agents.autonomy.write and switches with agents.killswitch.

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from inbox_items where id = any(${made.items})`;
    await m`delete from agent_configs where id = any(${made.configs})`;
    await m`delete from agent_evals where id = any(${made.evals})`;
  });
  await closeDb();
});

const made = { items: [] as string[], configs: [] as string[], evals: [] as string[] };

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

const runAs = (who: Principal, statement: SQL) =>
  asPrincipal(who, async ({ tx }) => (await tx.execute(statement)) as unknown as unknown[]);

async function count(who: Principal, table: string, id: string): Promise<number> {
  const rows = (await runAs(
    who,
    sql`select count(*)::int as n from ${sql.identifier(table)} where id = ${id}`,
  )) as { n: number }[];
  return rows[0]?.n ?? -1;
}

const COPILOT = AGENT_PRINCIPAL_IDS['agent:copilot'];
const agent = (entityIds: number[] = [1]) =>
  principalFor('agent:copilot', entityIds, { id: COPILOT });

const insertRun = (id: string, entityId = 1, name = 'agent:copilot', principalId = COPILOT) =>
  sql`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, outcome, request_id)
      values (${id}, ${entityId}, ${name}, ${principalId}, 'rls_check', 'crm.task.create', 'proposed', 'rls')`;

const insertAction = (id: string, runId: string, state = 'proposed') =>
  sql`insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json, autonomy, state, created_by)
      values (${id}, 1, ${runId}, 'agent:copilot', 'crm.task.create', '{}'::jsonb, 'suggest', ${state}, ${COPILOT})`;

const insertItem = (id: string, actionId: string, assignee: string | null, team: string | null) =>
  sql`insert into inbox_items (id, entity_id, kind, assignee_id, team_id, subject_type, subject_id, agent_action_id, created_by)
      values (${id}, 1, 'agent_suggestion', ${assignee}, ${team}, 'opportunity', ${newId()}, ${actionId}, ${COPILOT})`;

/** A run, an action and an inbox item filed by the agent, for `assignee` in `team`. */
async function suggestion(
  assignee: string | null,
  team: string | null,
): Promise<{ run: string; action: string; item: string }> {
  const ids = { run: newId(), action: newId(), item: newId() };
  await runAs(agent(), insertRun(ids.run));
  await runAs(agent(), insertAction(ids.action, ids.run));
  await runAs(agent(), insertItem(ids.item, ids.action, assignee, team));
  made.items.push(ids.item);
  return ids;
}

let team: string;
let caller: Principal;
let otherCaller: Principal;
let teamLead: Principal;
let gm: Principal;
let executive: Principal;

beforeAll(async () => {
  team = await createTestTeam(1, 'agents rls team');
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId: team });
  otherCaller = await createTestPrincipal('tele_caller_cc', [1], { teamId: team });
  teamLead = await createTestPrincipal('sales_team_lead', [1], { teamId: team });
  gm = await createTestPrincipal('general_manager', [1]);
  executive = await createTestPrincipal('executive');
});

describe('agent_runs (0093)', () => {
  it('an agent records its own run and cannot read it back; the controls read it', async () => {
    const id = newId();
    await runAs(agent(), insertRun(id));
    expect(await count(agent(), 'agent_runs', id)).toBe(0);
    expect(await count(caller, 'agent_runs', id)).toBe(0);
    expect(await count(gm, 'agent_runs', id)).toBe(1);
    expect(await count(executive, 'agent_runs', id)).toBe(1);
    expect(await count(principalFor('executive', [2]), 'agent_runs', id)).toBe(0);
  });

  it('refuses a run by a person, for another agent, for another principal or company', async () => {
    expect(await failure(runAs(gm, insertRun(newId(), 1, 'agent:copilot', gm.id)))).toMatch(
      /row-level security/,
    );
    expect(await failure(runAs(agent(), insertRun(newId(), 1, 'agent:triage')))).toMatch(
      /row-level security/,
    );
    const triage = AGENT_PRINCIPAL_IDS['agent:triage'];
    expect(await failure(runAs(agent(), insertRun(newId(), 1, 'agent:copilot', triage)))).toMatch(
      /row-level security/,
    );
    expect(await failure(runAs(agent(), insertRun(newId(), 2)))).toMatch(/row-level security/);
  });

  it('is append-only, even for the table owner', async () => {
    const id = newId();
    await runAs(agent(), insertRun(id));
    expect(
      await failure(runAs(executive, sql`update agent_runs set cost_paise = 0 where id = ${id}`)),
    ).toMatch(/permission denied/);
    expect(
      await failure(asMigrator((m) => m`update agent_runs set cost_paise = 1 where id = ${id}`)),
    ).toMatch(/append-only/);
    expect(await failure(asMigrator((m) => m`delete from agent_runs where id = ${id}`))).toMatch(
      /append-only/,
    );
  });
});

describe('agent_actions and inbox_items (0093)', () => {
  it('only an agent files a suggestion, and only as proposed or executed', async () => {
    const run = newId();
    await runAs(agent(), insertRun(run));
    expect(await failure(runAs(agent(), insertAction(newId(), run, 'approved')))).toMatch(
      /row-level security/,
    );
    const action = newId();
    expect(await failure(runAs(gm, insertAction(action, run)))).toMatch(/row-level security/);
    await runAs(agent(), insertAction(action, run));
    expect(await failure(runAs(gm, insertItem(newId(), action, null, null)))).toMatch(
      /row-level security/,
    );
  });

  it('shows an item to its assignee, their team lead and the company, never another caller', async () => {
    const { item, action } = await suggestion(caller.id, team);
    expect(await count(caller, 'inbox_items', item)).toBe(1);
    expect(await count(caller, 'agent_actions', action)).toBe(1);
    expect(await count(otherCaller, 'inbox_items', item)).toBe(0);
    expect(await count(otherCaller, 'agent_actions', action)).toBe(0);
    expect(await count(teamLead, 'inbox_items', item)).toBe(1);
    expect(await count(gm, 'inbox_items', item)).toBe(1);
    expect(await count(agent(), 'inbox_items', item)).toBe(0);
    expect(await count(principalFor('general_manager', [2]), 'inbox_items', item)).toBe(0);
  });

  it('shows an item for no one only at company scope', async () => {
    const { item } = await suggestion(null, null);
    expect(await count(caller, 'inbox_items', item)).toBe(0);
    expect(await count(teamLead, 'inbox_items', item)).toBe(0);
    expect(await count(gm, 'inbox_items', item)).toBe(1);
  });

  it('takes a decision once, as the caller’s own, and never changes what was proposed', async () => {
    const { item, action } = await suggestion(caller.id, team);
    const decide = (who: Principal, by: string) =>
      runAs(
        who,
        sql`update agent_actions set state = 'approved', decided_by = ${by}, decided_at = now()
             where id = ${action} returning id`,
      );
    expect(await decide(otherCaller, otherCaller.id)).toHaveLength(0);
    expect(await failure(decide(caller, gm.id))).toMatch(/row-level security/);
    expect(
      await failure(
        runAs(caller, sql`update agent_actions set input_json = '{"x":1}' where id = ${action}`),
      ),
    ).toMatch(/permission denied/);
    expect(await decide(caller, caller.id)).toHaveLength(1);
    expect(await decide(caller, caller.id)).toHaveLength(0);
    expect(
      await failure(
        asMigrator((m) => m`update agent_actions set state = 'rejected' where id = ${action}`),
      ),
    ).toMatch(/only its decision, once/);
    expect(
      await failure(asMigrator((m) => m`delete from agent_actions where id = ${action}`)),
    ).toMatch(/append-only/);
    const closed = await runAs(
      caller,
      sql`update inbox_items set state = 'done', done_by = ${caller.id}, done_at = now()
           where id = ${item} returning id`,
    );
    expect(closed).toHaveLength(1);
  });
});

describe('agent_configs (0093)', () => {
  const insertConfig = (
    id: string,
    entityId: number | null,
    extra: { autonomy?: string; enabled?: boolean; agent?: string } = {},
    by: string = executive.id,
  ) =>
    sql`insert into agent_configs (id, agent, action_type, entity_id, autonomy, enabled, created_by)
        values (${id}, ${extra.agent ?? 'agent:sizing'}, null, ${entityId}, ${extra.autonomy ?? null},
                ${extra.enabled ?? true}, ${by})`;

  it('every principal of a company reads its settings and the group’s; nobody without context', async () => {
    const id = newId();
    made.configs.push(id);
    await runAs(executive, insertConfig(id, 1, { agent: 'agent:chief' }));
    expect(await count(caller, 'agent_configs', id)).toBe(1);
    expect(await count(agent(), 'agent_configs', id)).toBe(1);
    expect(await count(principalFor('executive', [2]), 'agent_configs', id)).toBe(0);
    const [row] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from agent_configs`,
    );
    expect(row?.n).toBe(0);
  });

  it('a switch needs agents.killswitch, autonomy agents.autonomy.write', async () => {
    const off = newId();
    made.configs.push(off);
    expect(
      await failure(runAs(caller, insertConfig(newId(), 1, { enabled: false }, caller.id))),
    ).toMatch(/row-level security|agents\.killswitch/);
    expect(
      await failure(runAs(caller, insertConfig(newId(), 1, { agent: 'agent:chief' }, caller.id))),
    ).toMatch(/row-level security/);
    // A GM stops an agent in their company, but cannot change its autonomy.
    await runAs(gm, insertConfig(off, 1, { enabled: false }, gm.id));
    expect(
      await failure(
        runAs(gm, sql`update agent_configs set autonomy = 'suggest' where id = ${off}`),
      ),
    ).toMatch(/permission denied|agents\.autonomy\.write/);
    expect(
      await failure(
        runAs(gm, insertConfig(newId(), 1, { autonomy: 'suggest', agent: 'agent:chief' }, gm.id)),
      ),
    ).toMatch(/agents\.autonomy\.write/);
    await runAs(
      executive,
      sql`update agent_configs set autonomy = 'needs_approval' where id = ${off}`,
    );
    expect(
      await failure(
        runAs(executive, sql`update agent_configs set agent = 'agent:triage' where id = ${off}`),
      ),
    ).toMatch(/permission denied|keeps its agent/);
  });

  it('a setting for the group needs a request for every company', async () => {
    const narrowed = principalFor('executive', [1], { id: executive.id });
    expect(
      await failure(runAs(narrowed, insertConfig(newId(), null, { agent: 'agent:orchestrator' }))),
    ).toMatch(/row-level security/);
    const id = newId();
    made.configs.push(id);
    await runAs(executive, insertConfig(id, null, { agent: 'agent:concierge' }));
    expect(await count(narrowed, 'agent_configs', id)).toBe(1);
  });

  it('keeps one row per agent, action type and company, nulls not distinct', async () => {
    const id = newId();
    made.configs.push(id);
    await runAs(executive, insertConfig(id, 3, { agent: 'agent:chief' }));
    expect(
      await failure(runAs(executive, insertConfig(newId(), 3, { agent: 'agent:chief' }))),
    ).toMatch(/agent_configs_scope_unique/);
  });
});

describe('agent_evals (0093)', () => {
  it('is a platform table: only the owner writes it, an Executive for every company reads it', async () => {
    expect(PLATFORM_TABLES).toContain('agent_evals');
    const id = newId();
    made.evals.push(id);
    await asMigrator(
      (
        m,
      ) => m`insert into agent_evals (id, agent, prompt_version, model, eval_set, cases_total, cases_passed, score, ran_at)
               values (${id}, 'agent:triage', 'v1', 'claude-haiku-4-5-20251001', 'rls', 10, 9, 90, now())`,
    );
    expect(await count(executive, 'agent_evals', id)).toBe(1);
    expect(await count(gm, 'agent_evals', id)).toBe(0);
    expect(await count(principalFor('executive', []), 'agent_evals', id)).toBe(0);
    expect(
      await failure(
        runAs(
          executive,
          sql`insert into agent_evals (id, agent, prompt_version, model, eval_set, cases_total, cases_passed, score, ran_at)
              values (${newId()}, 'agent:triage', 'v1', 'm', 'rls', 1, 1, 100, now())`,
        ),
      ),
    ).toMatch(/permission denied/);
    const [privileges] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_reader', 'agent_evals', 'SELECT') as reader,
             has_any_column_privilege('readonly_reporter', 'agent_evals', 'SELECT') as reporter,
             has_any_column_privilege('app_user', 'agent_evals', 'UPDATE') as u`);
    expect(privileges).toEqual({ reader: true, reporter: false, u: false });
  });
});
