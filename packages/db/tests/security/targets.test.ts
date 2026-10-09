import { newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PIPELINE_SEED, stageId } from '../../seeds/pipelines';
import { tierId } from '../../seeds/price-tiers';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestTeam,
  createTestUser,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// Targets (docs/03-roadmap-appendix/phase1.md §9, docs/05-database.md §6.2, migrations 0124 and
// 0125): read by the subject (their own, their team's), by the team lead over the team, by the GM
// over the company and by the Executive; set by a holder of sales.targets.write as themselves;
// never changed. The progress of a target is counted by app.target_actuals(), which answers the
// caller for themselves and a team lead for the team. The suites never clean these tables, so
// every row here is found by this run's own ids.

afterAll(closeDb);

const E = 1;

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

let teamA: string;
let teamB: string;
let callerA1: Principal;
let callerA2: Principal;
let callerB: Principal;
let leadA: Principal;
let leadB: Principal;
let gm: Principal;
let exec: Principal;
let accounts: Principal;
let agent: Principal;
/** A lead in company 1 the actuals' calls and moves are on. */
let opportunityId: string;
let accountId: string;
const T: Record<string, string> = {};

function insertTarget(
  by: Principal,
  row: {
    id?: string;
    scope?: 'caller' | 'team';
    subject: string;
    team: string;
    metric?: string;
    period?: string;
    startsOn?: string;
    value?: number;
    setBy?: string;
    entityId?: number;
  },
) {
  const id = row.id ?? newId();
  return rows(
    by,
    sql`insert into targets (id, entity_id, scope, subject_id, team_id, metric, period, starts_on, value, set_by)
        values (${id}, ${row.entityId ?? E}, ${row.scope ?? 'caller'}, ${row.subject}, ${row.team},
                ${row.metric ?? 'calls'}, ${row.period ?? 'day'}, ${row.startsOn ?? '2031-04-01'},
                ${row.value ?? 25}, ${row.setBy ?? by.id})`,
  ).then(() => id);
}

async function seen(principal: Principal): Promise<string[]> {
  const ids = Object.values(T);
  const found = await rows<{ id: string }>(
    principal,
    sql`select id from targets where id = any(${`{${ids.join(',')}}`}::uuid[])`,
  );
  const names = Object.entries(T);
  return found.map((r) => names.find(([, id]) => id === r.id)?.[0] ?? r.id).sort();
}

beforeAll(async () => {
  teamA = await createTestTeam(E, 'targets team A');
  teamB = await createTestTeam(E, 'targets team B');
  const [a1, a2, b, la, lb, g, x, ac] = await Promise.all([
    createTestUser([{ entityId: E, roleKey: 'tele_caller_cc', teamId: teamA }], {
      name: 'Target A1',
    }),
    createTestUser([{ entityId: E, roleKey: 'tele_caller_lc', teamId: teamA }], {
      name: 'Target A2',
    }),
    createTestUser([{ entityId: E, roleKey: 'tele_caller_cc', teamId: teamB }], {
      name: 'Target B',
    }),
    createTestUser([{ entityId: E, roleKey: 'sales_team_lead', teamId: teamA }], {
      name: 'Lead A',
    }),
    createTestUser([{ entityId: E, roleKey: 'sales_team_lead', teamId: teamB }], {
      name: 'Lead B',
    }),
    createTestUser([{ entityId: E, roleKey: 'general_manager' }], { name: 'GM' }),
    createTestUser([{ entityId: E, roleKey: 'executive' }], { name: 'Exec' }),
    createTestUser([{ entityId: E, roleKey: 'accounts' }], { name: 'Accounts' }),
  ]);
  callerA1 = principalFor('tele_caller_cc', [E], { id: a1.id, teamId: teamA });
  callerA2 = principalFor('tele_caller_lc', [E], { id: a2.id, teamId: teamA });
  callerB = principalFor('tele_caller_cc', [E], { id: b.id, teamId: teamB });
  leadA = principalFor('sales_team_lead', [E], { id: la.id, teamId: teamA });
  leadB = principalFor('sales_team_lead', [E], { id: lb.id, teamId: teamB });
  gm = principalFor('general_manager', [E], { id: g.id });
  exec = principalFor('executive', [E], { id: x.id });
  accounts = principalFor('accounts', [E], { id: ac.id });
  agent = principalFor('agent:copilot', [E], { id: callerA1.id, teamId: teamA });

  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('pipeline seed missing');
  opportunityId = newId();
  accountId = newId();
  await asMigrator(async (m) => {
    await m`insert into accounts (id, type, name, created_by) values (${accountId}, 'farm', 'Target account', ${a1.id})`;
    await m`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
      values (${newId()}, ${accountId}, ${E}, ${a1.id}, ${teamA}, ${a1.id})`;
    await m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
      values (${opportunityId}, ${E}, ${accountId}, ${pipeline.id}, ${stageId(1, 1)}, ${a1.id}, ${teamA}, ${a1.id})`;
  });

  // Rows written by the migrator, one of each kind for the read tests.
  for (const [name, scope, subject, team] of [
    ['a1', 'caller', callerA1.id, teamA],
    ['a2', 'caller', callerA2.id, teamA],
    ['b', 'caller', callerB.id, teamB],
    ['teamA', 'team', teamA, teamA],
    ['teamB', 'team', teamB, teamB],
  ] as const) {
    const id = newId();
    T[name] = id;
    await asMigrator(
      (
        mig,
      ) => mig`insert into targets (id, entity_id, scope, subject_id, team_id, metric, period, starts_on, value, set_by)
        values (${id}, ${E}, ${scope}, ${subject}, ${team}, 'calls', 'day', '2031-04-01', 20, ${exec.id})`,
    );
  }
  const otherCompany = newId();
  T.company2 = otherCompany;
  await asMigrator(
    (
      mig,
    ) => mig`insert into targets (id, entity_id, scope, subject_id, team_id, metric, period, starts_on, value, set_by)
      values (${otherCompany}, 2, 'team', ${teamA}, ${teamA}, 'calls', 'day', '2031-04-01', 20, ${exec.id})`,
  );
});

describe('who reads a target', () => {
  it('a caller reads their own and their team’s, not a teammate’s or another team’s', async () => {
    expect(await seen(callerA1)).toEqual(['a1', 'teamA']);
    expect(await seen(callerA2)).toEqual(['a2', 'teamA']);
    expect(await seen(callerB)).toEqual(['b', 'teamB']);
  });

  it('a team lead reads their team and its callers, not another team’s', async () => {
    expect(await seen(leadA)).toEqual(['a1', 'a2', 'teamA']);
    expect(await seen(leadB)).toEqual(['b', 'teamB']);
  });

  it('the GM reads the company, the Executive every company they act in', async () => {
    expect(await seen(gm)).toEqual(['a1', 'a2', 'b', 'teamA', 'teamB']);
    expect(await seen(principalFor('executive', [E, 2], { id: exec.id }))).toEqual([
      'a1',
      'a2',
      'b',
      'company2',
      'teamA',
      'teamB',
    ]);
  });

  it('a role that sets no targets and is in no team reads none', async () => {
    expect(await seen(accounts)).toEqual([]);
  });

  it('nobody reads a target without a context', async () => {
    const found = await withoutContext<{ id: string }>(
      sql`select id from targets where id = ${T.a1 ?? ''}`,
    );
    expect(found).toHaveLength(0);
  });
});

describe('who sets a target', () => {
  it('a team lead sets a caller’s target and the team’s, for their own team', async () => {
    T.setA1 = await insertTarget(leadA, { subject: callerA1.id, team: teamA, metric: 'qualified' });
    T.setTeamA = await insertTarget(leadA, {
      scope: 'team',
      subject: teamA,
      team: teamA,
      period: 'week',
      startsOn: '2031-03-31',
    });
    expect(await seen(callerA1)).toContain('setA1');
  });

  it('a team lead cannot set a target for another team, or for a caller under the wrong team', async () => {
    expect(await failure(insertTarget(leadA, { subject: callerB.id, team: teamB }))).toMatch(
      /row-level security/,
    );
    expect(await failure(insertTarget(leadA, { subject: callerB.id, team: teamA }))).toMatch(
      /row-level security/,
    );
    expect(
      await failure(insertTarget(leadA, { scope: 'team', subject: teamB, team: teamB })),
    ).toMatch(/row-level security/);
  });

  it('the GM sets the target of any caller of the company, the Executive of any company they act in', async () => {
    T.gmB = await insertTarget(gm, { subject: callerB.id, team: teamB, metric: 'orders' });
    T.execB = await insertTarget(exec, { subject: callerB.id, team: teamB, metric: 'kw' });
    expect(await seen(callerB)).toEqual(expect.arrayContaining(['gmB', 'execB']));
  });

  it('a caller, Accounts and an agent set none', async () => {
    for (const who of [callerA1, accounts, agent]) {
      expect(await failure(insertTarget(who, { subject: callerA1.id, team: teamA }))).toMatch(
        /row-level security/,
      );
    }
  });

  it('only as themselves, and only for a company of the request', async () => {
    expect(
      await failure(insertTarget(leadA, { subject: callerA1.id, team: teamA, setBy: exec.id })),
    ).toMatch(/row-level security/);
    expect(
      await failure(insertTarget(exec, { subject: callerA1.id, team: teamA, entityId: 2 })),
    ).toMatch(/row-level security/);
  });

  it('a target is for an active person who logs calls, not an offboarded one or a field engineer', async () => {
    const gone = await createTestUser([{ entityId: E, roleKey: 'tele_caller_cc', teamId: teamA }], {
      name: 'Target Gone',
      status: 'offboarded',
    });
    const store = await createTestUser(
      [{ entityId: E, roleKey: 'field_engineer', teamId: teamA }],
      {
        name: 'Target Field',
      },
    );
    for (const who of [leadA, gm, exec]) {
      expect(await failure(insertTarget(who, { subject: gone.id, team: teamA }))).toMatch(
        /row-level security/,
      );
      expect(await failure(insertTarget(who, { subject: store.id, team: teamA }))).toMatch(
        /row-level security/,
      );
    }
  });

  it('a person must work in the company under that team', async () => {
    expect(await failure(insertTarget(exec, { subject: newId(), team: teamA }))).toMatch(
      /row-level security/,
    );
    expect(await failure(insertTarget(exec, { subject: callerA1.id, team: teamB }))).toMatch(
      /row-level security/,
    );
  });
});

describe('a caller who moves to another team', () => {
  it('is read by the new team lead and no longer by the old one, whatever team the row records', async () => {
    const user = await createTestUser([{ entityId: E, roleKey: 'tele_caller_cc', teamId: teamA }], {
      name: 'Target Mover',
    });
    const mover = principalFor('tele_caller_cc', [E], { id: user.id, teamId: teamA });
    T.mover = await insertTarget(leadA, { subject: mover.id, team: teamA, value: 33 });
    expect(await seen(leadA)).toContain('mover');
    expect(await seen(leadB)).not.toContain('mover');
    await asMigrator(
      (m) => m`update user_entity_roles set team_id = ${teamB} where user_id = ${user.id}`,
    );
    expect(await seen(leadB)).toContain('mover');
    expect(await seen(leadA)).not.toContain('mover');
    expect(await seen(principalFor('tele_caller_cc', [E], { id: user.id, teamId: teamB }))).toEqual(
      ['mover', 'teamB'],
    );
    // The new team lead sets the next one under the new team; the old one cannot any more.
    T.moverNow = await insertTarget(leadB, { subject: mover.id, team: teamB, value: 12 });
    expect(await failure(insertTarget(leadA, { subject: mover.id, team: teamA }))).toMatch(
      /row-level security/,
    );
  });
});

describe('the table keeps its shape', () => {
  it('is append-only for every role', async () => {
    const id = T.a1 ?? '';
    expect(await failure(rows(exec, sql`update targets set value = 1 where id = ${id}`))).toMatch(
      /permission denied|append-only/,
    );
    expect(await failure(rows(exec, sql`delete from targets where id = ${id}`))).toMatch(
      /permission denied|append-only/,
    );
    expect(
      await failure(asMigrator((m) => m`update targets set value = 1 where id = ${id}`)),
    ).toMatch(/append-only|not allowed/i);
  });

  it('refuses a week that does not start on a Monday, a month that does not start on the 1st and a negative value', async () => {
    const bad = (period: string, startsOn: string, value = 5) =>
      failure(insertTarget(exec, { subject: callerA1.id, team: teamA, period, startsOn, value }));
    expect(await bad('week', '2031-04-02')).toMatch(/targets_starts_on_check/);
    expect(await bad('month', '2031-04-02')).toMatch(/targets_starts_on_check/);
    expect(await bad('day', '2031-04-02', -1)).toMatch(/targets_value_check/);
  });

  it('refuses a team target whose subject is not its team', async () => {
    expect(
      await failure(insertTarget(exec, { scope: 'team', subject: teamA, team: teamB })),
    ).toMatch(/targets_team_subject_check|row-level security/);
  });
});

describe('app.target_actuals()', () => {
  const FROM = '2031-04-01T00:00:00+05:30';
  const TO = '2031-04-02T00:00:00+05:30';
  const actuals = (who: Principal, users: string[], entity = E) =>
    rows<{
      subject_id: string;
      calls_n: number;
      qualified_n: number;
      orders_n: number;
      kw_n: string;
    }>(
      who,
      sql`select subject_id, calls_n, qualified_n, orders_n, kw_n::text
            from app.target_actuals(${entity}::smallint, ${FROM}::timestamptz, ${TO}::timestamptz,
                                    ${`{${users.join(',')}}`}::uuid[])`,
    );

  beforeAll(async () => {
    const [disposition] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from call_dispositions
        where entity_id is null and segment is null and archived_at is null order by position limit 1`,
    );
    if (!disposition) throw new Error('no call outcome seeded');
    await asMigrator(async (m) => {
      // A1 logged three calls on the day and one before it; A2 one; the call of a lead handed
      // on since still counts for the person who made it.
      for (const [caller, at] of [
        [callerA1.id, '2031-04-01T10:00:00+05:30'],
        [callerA1.id, '2031-04-01T23:59:59+05:30'],
        [callerA1.id, '2031-04-01T00:00:00+05:30'],
        [callerA1.id, '2031-03-31T23:59:59+05:30'],
        [callerA2.id, '2031-04-01T12:00:00+05:30'],
      ] as const) {
        await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series, disposition_id, attempt_no, started_at)
          values (${newId()}, ${E}, ${opportunityId}, ${caller}, 'outbound', 'manual', ${disposition.id}, 1, ${at})`;
      }
      // A1 moved the lead to Qualified twice on the day (counted once) and to another stage.
      for (const [key, at] of [
        ['qualified', '2031-04-01T11:00:00+05:30'],
        ['qualified', '2031-04-01T13:00:00+05:30'],
        ['quoted', '2031-04-01T13:00:00+05:30'],
      ] as const) {
        await m`insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, payload_json, created_at)
          values (${newId()}, ${E}, ${opportunityId}, ${accountId}, 'stage_moved', ${callerA1.id},
                  ${m.json({ toStageKey: key })}, ${at})`;
      }
      // Two orders A2 confirmed on the day, one on the lead (with a rooftop sizing of 3.5 kWp made
      // earlier and a newer pump sizing of 2.2 kW that is out of bounds, so the rooftop counts),
      // one cancelled, and one A1 confirmed the day before.
      await m`insert into sizings (id, entity_id, opportunity_id, kind, inputs_json, result_json, in_bounds, reasons_json, engine_version, created_by, created_at)
        values (${newId()}, ${E}, ${opportunityId}, 'rooftop', '{}'::jsonb,
                ${m.json({ rooftop: { recommendedKwp: 3.5 } })}, true, '[]'::jsonb, 'test', ${callerA1.id}, '2031-03-30T10:00:00+05:30'),
               (${newId()}, ${E}, ${opportunityId}, 'pump', '{}'::jsonb,
                ${m.json({ power: { standardKw: 2.2 } })}, false, '["x"]'::jsonb, 'test', ${callerA1.id}, '2031-03-31T10:00:00+05:30')`;
      const dealerAccount = newId();
      await m`insert into accounts (id, type, name, created_by) values (${dealerAccount}, 'dealer', 'Target dealer', ${callerA1.id})`;
      const order = (id: string, state: string, at: string, by: string, lead: boolean) =>
        m.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id, tier_id,
                      place_of_supply_state, supply_kind, state, cancel_reason, confirmed_at, confirmed_by,
                      subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
              values (${id}, ${E}, ${`TGT/${id}`}, '2098-99', ${lead ? newId() : null}, ${lead ? opportunityId : null},
                      ${lead ? accountId : dealerAccount}, ${tierId('dealer')},
                      '08', 'intra', ${state}, ${state === 'cancelled' ? 'test' : null}, ${at}, ${by}, 0, 0, 0, 0, 0, 0, 0, ${by})`;
        });
      await order(newId(), 'confirmed', '2031-04-01T14:00:00+05:30', callerA2.id, true);
      await order(newId(), 'dispatched', '2031-04-01T15:00:00+05:30', callerA2.id, false);
      await order(newId(), 'cancelled', '2031-04-01T16:00:00+05:30', callerA2.id, false);
      // The period ends at TO, which it excludes: a call, a lead order and a dealer order at that
      // very instant count in no figure of the day.
      await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series, disposition_id, attempt_no, started_at)
        values (${newId()}, ${E}, ${opportunityId}, ${callerA1.id}, 'outbound', 'manual', ${disposition.id}, 1, ${TO})`;
      await order(newId(), 'confirmed', TO, callerA1.id, true);
      await order(newId(), 'confirmed', TO, callerA2.id, false);
      // A sizing made after A2 confirmed the lead's order (14:00) is not the one the order was
      // confirmed on: its 9 kWp does not count.
      await m`insert into sizings (id, entity_id, opportunity_id, kind, inputs_json, result_json, in_bounds, reasons_json, engine_version, created_by, created_at)
        values (${newId()}, ${E}, ${opportunityId}, 'rooftop', '{}'::jsonb,
                ${m.json({ rooftop: { recommendedKwp: 9 } })}, true, '[]'::jsonb, 'test', ${callerA1.id}, '2031-04-01T14:30:00+05:30')`;
      await order(newId(), 'confirmed', '2031-03-31T16:00:00+05:30', callerA1.id, false);
    });
  });

  it('counts a caller’s own calls, moves to Qualified, orders and kW in the period', async () => {
    const [mine] = await actuals(callerA1, [callerA1.id]);
    expect(mine).toMatchObject({ calls_n: 3, qualified_n: 1, orders_n: 0, kw_n: '0.00' });
    const [hers] = await actuals(callerA2, [callerA2.id]);
    // A lead order (its newest in-bounds sizing is the rooftop's 3.5) and a dealer order; the
    // cancelled one does not count.
    expect(hers).toMatchObject({ calls_n: 1, qualified_n: 0, orders_n: 2, kw_n: '3.50' });
  });

  it('counts for the caller even where they can no longer read the lead', async () => {
    // A2 cannot read A1's lead row by row (own scope), yet has its call counted for them.
    const lead = await rows(
      callerA2,
      sql`select id from opportunities where id = ${opportunityId}`,
    );
    expect(lead).toHaveLength(0);
    const [hers] = await actuals(callerA2, [callerA2.id]);
    expect(hers?.calls_n).toBe(1);
  });

  it('answers a team lead for the team and refuses another team’s callers', async () => {
    const team = await actuals(leadA, [callerA1.id, callerA2.id]);
    expect(team.map((r) => [r.calls_n, r.orders_n]).sort()).toEqual([
      [1, 2],
      [3, 0],
    ]);
    expect(await failure(actuals(leadA, [callerB.id]))).toMatch(/yourself, or for your team/);
    expect(await failure(actuals(leadB, [callerA1.id]))).toMatch(/yourself, or for your team/);
  });

  it('refuses a caller asking for a teammate, and answers the GM and the Executive for the company', async () => {
    expect(await failure(actuals(callerA1, [callerA2.id]))).toMatch(/yourself, or for your team/);
    expect(await actuals(gm, [callerA1.id, callerB.id])).toHaveLength(2);
    expect(await actuals(exec, [callerB.id])).toHaveLength(1);
  });

  it('refuses a company outside the request, an agent and Accounts for another person', async () => {
    expect(await failure(actuals(callerA1, [callerA1.id], 2))).toMatch(/outside the request/);
    expect(await failure(actuals(agent, [callerA1.id]))).toMatch(/outside the request/);
    const workers = principalFor('system:workers', [E], { id: callerA1.id });
    expect(await failure(actuals(workers, [callerA1.id]))).toMatch(/outside the request/);
    expect(await failure(actuals(accounts, [callerA1.id]))).toMatch(/yourself, or for your team/);
  });

  it('is not callable by the reporting role', async () => {
    const message = await failure(
      asMigrator(async (m) => {
        await m`set role readonly_reporter`;
        try {
          await m`select * from app.target_actuals(1::smallint, now(), now(), '{}'::uuid[])`;
        } finally {
          await m`reset role`;
        }
      }),
    );
    expect(message).toMatch(/permission denied/);
  });
});
