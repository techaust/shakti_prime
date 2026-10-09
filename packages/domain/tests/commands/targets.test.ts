import { hasGrant, newId, type Principal, type TargetDto } from '@shakti/contracts';
import { loadUserGrants } from '@shakti/db/grants';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { principalForEntity, resolvePrincipalFromGrants } from '../../src/auth/resolve-principal';
import { failureOf, runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { setTarget } from '../../src/commands/sales/set-target';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { homeCaller } from '../../src/queries/home/home';
import {
  currentStarts,
  myProgress,
  targetsScreen,
  teamProgress,
} from '../../src/queries/sales/targets';

// sales.target.set and the progress queries (docs/03-roadmap-appendix/phase1.md §9, PRD TEL-06):
// a team lead sets the targets of their own team and its callers, the GM those of the company, the
// Executive any; a target holds from the period it starts in until a newer one; the progress of a
// caller counts their own calls whether or not they can still read the lead, and a team lead sees
// their team and no other. The people, teams and rows here are this file's own, in company 2,
// and the figures are synthetic test values, never a client target.

const E = 2;
const NOW = new Date();
const STARTS = currentStarts(NOW);
const FAR_PAST = '2020-01-06';

let teamA: string;
let teamB: string;
let callerA1: Principal;
let callerA2: Principal;
let callerB: Principal;
let noTeam: Principal;
let leadA: Principal;
let leadB: Principal;
let gm: Principal;
let exec: Principal;
let accountsUser: Principal;
let outcome: string;

beforeAll(async () => {
  teamA = await createTestTeam(E, 'target team A');
  teamB = await createTestTeam(E, 'target team B');
  const make = async (
    role: Parameters<typeof principalFor>[0],
    team: string | undefined,
    name: string,
  ) => {
    const user = await createTestUser(
      [{ entityId: E, roleKey: role, ...(team === undefined ? {} : { teamId: team }) }],
      { name },
    );
    return createTestPrincipal(role, [E], {
      id: user.id,
      ...(team === undefined ? {} : { teamId: team }),
    });
  };
  callerA1 = await make('tele_caller_cc', teamA, 'Target Caller A1');
  callerA2 = await make('tele_caller_lc', teamA, 'Target Caller A2');
  callerB = await make('tele_caller_cc', teamB, 'Target Caller B');
  noTeam = await make('tele_caller_cc', undefined, 'Target Caller No Team');
  leadA = await make('sales_team_lead', teamA, 'Target Lead A');
  leadB = await make('sales_team_lead', teamB, 'Target Lead B');
  gm = await make('general_manager', undefined, 'Target GM');
  exec = await make('executive', undefined, 'Target Exec');
  accountsUser = await make('accounts', undefined, 'Target Accounts');
  const [row] = await asMigrator(
    (m) => m<{ id: string }[]>`select id from call_dispositions
      where entity_id is null and segment is null and archived_at is null order by position limit 1`,
  );
  if (!row) throw new Error('no call outcome seeded');
  outcome = row.id;
});

afterAll(closeDb);

function run<T>(principal: Principal, command: AnyCommand, input: unknown, now = NOW): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, now }, input),
  ) as Promise<T>;
}

async function failure(principal: Principal, input: unknown) {
  const error: unknown = await run(principal, setTarget, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  const e = error as { code?: string; details?: { reason?: unknown } } | undefined;
  return { code: e?.code, reason: e?.details?.reason, stage: failureOf(error)?.stage };
}

const input = (subject: Principal | string, extra: Record<string, unknown> = {}) => ({
  entityId: E,
  scope: 'caller',
  subjectId: typeof subject === 'string' ? subject : subject.id,
  metric: 'calls',
  period: 'day',
  startsOn: STARTS.day,
  value: 20,
  ...extra,
});

describe('sales.target.set: who may set a target', () => {
  it('a team lead sets the target of a caller of their team and of their team', async () => {
    const one = await run<TargetDto>(leadA, setTarget, input(callerA1));
    expect(one).toMatchObject({
      scope: 'caller',
      subjectId: callerA1.id,
      subjectName: 'Target Caller A1',
      teamId: teamA,
      metric: 'calls',
      period: 'day',
      value: 20,
    });
    const team = await run<TargetDto>(
      leadA,
      setTarget,
      input(teamA, { scope: 'team', period: 'week', startsOn: STARTS.week, value: 100 }),
    );
    expect(team).toMatchObject({ scope: 'team', subjectId: teamA, teamId: teamA, value: 100 });
  });

  it('the GM sets the target of any caller of the company and the Executive of any', async () => {
    await expect(run(gm, setTarget, input(callerB))).resolves.toMatchObject({ teamId: teamB });
    await expect(run(exec, setTarget, input(callerA2, { metric: 'orders' }))).resolves.toBeTruthy();
  });

  it('is refused to a team lead for another team’s caller or team', async () => {
    expect(await failure(leadA, input(callerB))).toMatchObject({
      code: 'forbidden',
      reason: 'target_other_team',
    });
    expect(await failure(leadB, input(teamA, { scope: 'team' }))).toMatchObject({
      reason: 'target_other_team',
    });
  });

  it('is refused to a caller, to Accounts and to an agent, whatever it holds', async () => {
    for (const who of [callerA1, accountsUser]) {
      expect(await failure(who, input(callerA1))).toMatchObject({
        code: 'forbidden',
        stage: 'guard',
      });
    }
    const agent = principalFor('agent:copilot', [E], {
      permissions: [{ key: 'sales.targets.write', scope: 'entity' }],
    });
    expect(await failure(agent, input(callerA1))).toMatchObject({ reason: 'people_only' });
  });

  it('is refused for a company outside the request', async () => {
    expect(await failure(leadA, input(callerA1, { entityId: 1 }))).toMatchObject({
      code: 'forbidden',
    });
    const elsewhere = await createTestPrincipal('general_manager', [1]);
    expect(await failure(elsewhere, input(callerA1))).toMatchObject({ code: 'forbidden' });
  });

  it('is refused for a person who is not in the company, or in no team, and for a team that is not visible', async () => {
    expect(await failure(exec, input(newId()))).toMatchObject({ reason: 'target_subject_missing' });
    expect(await failure(exec, input(noTeam))).toMatchObject({ reason: 'target_caller_no_team' });
    expect(await failure(exec, input(newId(), { scope: 'team' }))).toMatchObject({
      reason: 'target_subject_missing',
    });
  });

  it('is refused for a date that does not start its period', async () => {
    // STARTS.day is a day; a week must start on a Monday and a month on the 1st.
    expect(
      await failure(leadA, input(callerA1, { period: 'week', startsOn: '2031-04-02' })),
    ).toMatchObject({ reason: 'target_period_start' });
    expect(
      await failure(leadA, input(callerA1, { period: 'month', startsOn: '2031-04-02' })),
    ).toMatchObject({ reason: 'target_period_start' });
  });

  it('refuses a negative value and a stray field', async () => {
    expect(await failure(leadA, input(callerA1, { value: -1 }))).toMatchObject({
      code: 'validation_failed',
    });
    expect(await failure(leadA, input(callerA1, { surprise: true }))).toMatchObject({
      code: 'validation_failed',
    });
  });

  it('is audited with its figures and sends no event', async () => {
    const set = await run<TargetDto>(
      leadA,
      setTarget,
      input(callerA1, { metric: 'kw', value: 7.5 }),
    );
    const rows = await asMigrator(
      (m) => m<{ command: string; outcome: string; after_json: Record<string, unknown> }[]>`
        select command, outcome, after_json from audit_logs
         where aggregate_id = ${set.id} and command = 'sales.target.set'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'ok',
      after_json: { targetMetric: 'kw', targetPeriod: 'day', targetValue: 7.5 },
    });
    const events = await asOutboxPublisher(
      (p) => p`select 1 from outbox_events where aggregate_id = ${set.id}`,
    );
    expect(events).toHaveLength(0);
  });
});

describe('the target in force', () => {
  it('holds from the period it starts in until a newer one, and 0 takes it away', async () => {
    const who = await createTestUser([{ entityId: E, roleKey: 'tele_caller_cc', teamId: teamA }], {
      name: 'Target Effective',
    });
    const me = await createTestPrincipal('tele_caller_cc', [E], { id: who.id, teamId: teamA });
    const day = (n: number) => input(me, { startsOn: STARTS.day, value: n });
    // Set for a day far in the past: it still holds today.
    await run(leadA, setTarget, input(me, { startsOn: FAR_PAST, period: 'week', value: 50 }));
    await run(leadA, setTarget, input(me, { startsOn: FAR_PAST, value: 10 }));
    const read = async () => {
      const [mine] = await asPrincipal(me, (ctx) => myProgress(ctx, {}, NOW));
      return mine?.periods;
    };
    let periods = await read();
    expect(periods?.find((p) => p.period === 'day')?.metrics[0]).toMatchObject({
      metric: 'calls',
      target: 10,
      actual: 0,
      fraction: 0,
    });
    expect(periods?.find((p) => p.period === 'week')?.metrics[0]?.target).toBe(50);
    expect(periods?.find((p) => p.period === 'month')?.metrics[0]?.target).toBeNull();

    // A newer one replaces it from its own period.
    await run(leadA, setTarget, day(30));
    periods = await read();
    expect(periods?.find((p) => p.period === 'day')?.metrics[0]?.target).toBe(30);

    // A target that starts tomorrow does not count today.
    const tomorrow = new Date(NOW.getTime() + 2 * 86_400_000);
    await run(leadA, setTarget, input(me, { startsOn: currentStarts(tomorrow).day, value: 99 }));
    periods = await read();
    expect(periods?.find((p) => p.period === 'day')?.metrics[0]?.target).toBe(30);

    // 0 takes it away: no target, no fraction.
    await run(leadA, setTarget, day(0));
    periods = await read();
    expect(periods?.find((p) => p.period === 'day')?.metrics[0]).toMatchObject({
      target: null,
      fraction: null,
    });
  });
});

describe('progress', () => {
  let leadId: string;
  let colleagueLead: string;
  let progressCaller: Principal;
  let colleague: Principal;

  const phone = () => `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function leadOf(owner: Principal): Promise<string> {
    const lead = await run<{ id: string }>(owner, createLead, {
      entityId: E,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Target customer', phone: phone() },
      account: { type: 'farm' },
      site: { type: 'borewell', village: 'Phulera', pin: '303338' },
    });
    return lead.id;
  }
  const logCalls = (caller: Principal, opportunityId: string, n: number) =>
    asMigrator(async (m) => {
      for (let i = 0; i < n; i += 1) {
        await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series, disposition_id, attempt_no, started_at)
          values (${newId()}, ${E}, ${opportunityId}, ${caller.id}, 'outbound', 'manual', ${outcome}, 1, ${NOW})`;
      }
    });

  beforeAll(async () => {
    const make = async (team: string, name: string) => {
      const user = await createTestUser(
        [{ entityId: E, roleKey: 'tele_caller_cc', teamId: team }],
        {
          name,
        },
      );
      return createTestPrincipal('tele_caller_cc', [E], { id: user.id, teamId: team });
    };
    progressCaller = await make(teamA, 'Progress Caller');
    colleague = await make(teamA, 'Progress Colleague');
    leadId = await leadOf(progressCaller);
    colleagueLead = await leadOf(colleague);
    await logCalls(progressCaller, leadId, 3);
    await logCalls(colleague, colleagueLead, 5);
    await run(leadA, setTarget, input(progressCaller, { value: 6 }));
    await run(leadA, setTarget, input(colleague, { value: 5 }));
    await run(leadA, setTarget, input(teamA, { scope: 'team', value: 40 }));
  });

  it('a caller sees their own count against their target', async () => {
    const [mine] = await asPrincipal(progressCaller, (ctx) => myProgress(ctx, {}, NOW));
    const day = mine?.periods.find((p) => p.period === 'day');
    expect(day).toMatchObject({ startsOn: STARTS.day });
    expect(day?.metrics.find((m) => m.metric === 'calls')).toEqual({
      metric: 'calls',
      target: 6,
      actual: 3,
      fraction: 0.5,
    });
  });

  it('still counts a caller’s calls on a lead they no longer own, which they cannot read', async () => {
    await asMigrator(
      (m) => m`update opportunities set owner_id = ${colleague.id} where id = ${leadId}`,
    );
    const rows = await asPrincipal(progressCaller, async ({ tx }) =>
      tx.execute(sql`select id from opportunities where id = ${leadId}`),
    );
    expect(rows as unknown as unknown[]).toHaveLength(0);
    const [mine] = await asPrincipal(progressCaller, (ctx) => myProgress(ctx, {}, NOW));
    expect(
      mine?.periods.find((p) => p.period === 'day')?.metrics.find((m) => m.metric === 'calls')
        ?.actual,
    ).toBe(3);
    const [home] = await asPrincipal(progressCaller, (ctx) => homeCaller(ctx, NOW));
    expect(home?.callsToday).toBe(3);
  });

  it('shows a team lead the team and its callers, ranked, and no other team’s', async () => {
    const [team] = await asPrincipal(leadA, (ctx) => teamProgress(ctx, { period: 'day' }, NOW));
    expect(team).toMatchObject({ teamId: teamA, teamName: 'target team A', metric: 'calls' });
    const names = team?.leaderboard.map((r) => r.callerName) ?? [];
    expect(names).toContain('Progress Caller');
    expect(names).toContain('Progress Colleague');
    expect(names).not.toContain('Target Caller B');
    // Ranked by calls, highest first: the colleague's 5 before the caller's 3.
    expect(names.indexOf('Progress Colleague')).toBeLessThan(names.indexOf('Progress Caller'));
    const calls = team?.team.find((m) => m.metric === 'calls');
    expect(calls?.target).toBe(40);
    expect(calls?.actual).toBeGreaterThanOrEqual(8);
    const row = team?.leaderboard.find((r) => r.callerName === 'Progress Caller');
    expect(row?.metrics.find((m) => m.metric === 'calls')).toMatchObject({ target: 6, actual: 3 });
  });

  it('shows team lead B only their own team', async () => {
    const [team] = await asPrincipal(leadB, (ctx) => teamProgress(ctx, { period: 'day' }, NOW));
    expect(team?.teamId).toBe(teamB);
    // The team lead logs calls too, so they are on their own board.
    expect(team?.leaderboard.map((r) => r.callerName)).toEqual([
      'Target Caller B',
      'Target Lead B',
    ]);
  });

  it('refuses the team view to a caller and to Accounts', async () => {
    for (const who of [progressCaller, accountsUser]) {
      await expect(asPrincipal(who, (ctx) => teamProgress(ctx, {}, NOW))).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('lists for the Targets page the team lead’s own team and callers, the GM’s every team', async () => {
    const lead = await asPrincipal(leadA, (ctx) => targetsScreen(ctx, { entityId: E }, NOW));
    expect(lead.subjects.filter((s) => s.scope === 'team').map((s) => s.id)).toEqual([teamA]);
    const names = lead.subjects.filter((s) => s.scope === 'caller').map((s) => s.name);
    expect(names).toContain('Progress Caller');
    expect(names).not.toContain('Target Caller B');
    expect(lead.current.find((t) => t.subjectId === progressCaller.id)).toMatchObject({
      metric: 'calls',
      value: 6,
      period: 'day',
    });
    expect(lead.history[0]?.setByName).toBeTruthy();
    expect(lead.periodStarts).toEqual(STARTS);
    expect(lead.nextStarts.day > STARTS.day).toBe(true);
    expect(lead.nextStarts.week > STARTS.week).toBe(true);
    expect(lead.nextStarts.month > STARTS.month).toBe(true);

    const manager = await asPrincipal(gm, (ctx) => targetsScreen(ctx, { entityId: E }, NOW));
    const teams = manager.subjects.filter((s) => s.scope === 'team').map((s) => s.id);
    expect(teams).toEqual(expect.arrayContaining([teamA, teamB]));
    expect(manager.subjects.map((s) => s.name)).toContain('Target Caller B');
  });

  it('refuses the Targets page for another company and for a caller', async () => {
    await expect(
      asPrincipal(leadA, (ctx) => targetsScreen(ctx, { entityId: 1 }, NOW)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(progressCaller, (ctx) => targetsScreen(ctx, { entityId: E }, NOW)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('a caller who moves to another team', () => {
  let mover: Principal;

  beforeAll(async () => {
    const user = await createTestUser([{ entityId: E, roleKey: 'tele_caller_cc', teamId: teamA }], {
      name: 'Target Mover',
    });
    mover = await createTestPrincipal('tele_caller_cc', [E], { id: user.id, teamId: teamA });
    await run(leadA, setTarget, input(mover, { value: 33 }));
    await asMigrator(
      (m) => m`update user_entity_roles set team_id = ${teamB} where user_id = ${mover.id}`,
    );
  });

  const targetOf = (
    rows: readonly { callerName: string; metrics: { target: number | null }[] }[],
  ) => rows.find((r) => r.callerName === 'Target Mover')?.metrics[0]?.target;

  it('shows on the new team lead’s leaderboard and Targets page with their target', async () => {
    const [team] = await asPrincipal(leadB, (ctx) => teamProgress(ctx, { period: 'day' }, NOW));
    expect(targetOf(team?.leaderboard ?? [])).toBe(33);
    const screen = await asPrincipal(leadB, (ctx) => targetsScreen(ctx, { entityId: E }, NOW));
    expect(screen.current.find((t) => t.subjectId === mover.id)).toMatchObject({ value: 33 });
    const [mine] = await asPrincipal(mover, (ctx) => myProgress(ctx, {}, NOW));
    expect(mine?.periods.find((p) => p.period === 'day')?.metrics[0]?.target).toBe(33);
  });

  it('is no longer read by the old team lead', async () => {
    const [team] = await asPrincipal(leadA, (ctx) => teamProgress(ctx, { period: 'day' }, NOW));
    expect(team?.leaderboard.map((r) => r.callerName)).not.toContain('Target Mover');
    const screen = await asPrincipal(leadA, (ctx) => targetsScreen(ctx, { entityId: E }, NOW));
    expect(screen.current.find((t) => t.subjectId === mover.id)).toBeUndefined();
    expect(screen.history.find((t) => t.subjectId === mover.id)).toBeUndefined();
  });

  it('is set from now on by the new team lead alone', async () => {
    await expect(run(leadB, setTarget, input(mover, { value: 12 }))).resolves.toMatchObject({
      teamId: teamB,
    });
    expect(await failure(leadA, input(mover))).toMatchObject({ reason: 'target_other_team' });
  });
});

describe('a target is set only for an active person who logs calls', () => {
  it('refuses an offboarded person and a person who does not log calls', async () => {
    const gone = await createTestUser([{ entityId: E, roleKey: 'tele_caller_cc', teamId: teamA }], {
      name: 'Target Gone',
      status: 'offboarded',
    });
    expect(await failure(leadA, input(gone.id))).toMatchObject({
      reason: 'target_subject_missing',
    });
    const store = await createTestUser(
      [{ entityId: E, roleKey: 'field_engineer', teamId: teamA }],
      {
        name: 'Target Field',
      },
    );
    expect(await failure(leadA, input(store.id))).toMatchObject({
      reason: 'target_subject_missing',
    });
    expect(await failure(exec, input(store.id))).toMatchObject({
      reason: 'target_subject_missing',
    });
  });
});

describe('a person with a different role in each company', () => {
  it('acts as a team lead where they are one, though All companies drops the grant', async () => {
    const otherTeam = await createTestTeam(1, 'target team elsewhere');
    const user = await createTestUser(
      [
        { entityId: E, roleKey: 'sales_team_lead', teamId: teamA },
        { entityId: 1, roleKey: 'tele_caller_cc', teamId: otherTeam },
      ],
      { name: 'Target Mixed' },
    );
    const outcomeOf = resolvePrincipalFromGrants(user.id, await loadUserGrants(user.id));
    if (outcomeOf.kind !== 'principal') throw new Error(`not a principal: ${outcomeOf.kind}`);
    const { principal: everywhere, access } = outcomeOf;
    expect(hasGrant(everywhere.permissions, 'sales.targets.write', 'team')).toBe(false);

    const here = principalForEntity(everywhere, access, E);
    if (!here) throw new Error('no role in the company');
    expect(here.entityIds).toEqual([E]);
    expect(hasGrant(here.permissions, 'sales.targets.write', 'team')).toBe(true);
    const [team] = await asPrincipal(here, (ctx) =>
      teamProgress(ctx, { entityId: E, period: 'day' }, NOW),
    );
    expect(team).toMatchObject({ teamId: teamA });

    // In the other company they are a caller: no team view there.
    const there = principalForEntity(everywhere, access, 1);
    if (!there) throw new Error('no role in the company');
    expect(hasGrant(there.permissions, 'sales.targets.write', 'team')).toBe(false);
    expect(principalForEntity(everywhere, access, 3)).toBeUndefined();
  });
});
