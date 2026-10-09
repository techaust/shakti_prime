import {
  DomainError,
  hasGrant,
  LeaderboardRowDto,
  MyProgressDto,
  MyProgressInput,
  TargetMetricSchema,
  TargetPeriodSchema,
  TargetsScreenDto,
  TargetsScreenInput,
  TeamProgressDto,
  TeamProgressInput,
  type MetricProgressDto,
  type PeriodProgressDto,
  type TargetMetric,
  type TargetPeriod,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { checkPermission, isAgent } from '../../command/run-command';
import { periodBounds, periodEndOn, periodStartOn, progressFraction } from '../../sales/targets';
import { teamIn } from '../crm/list-lead-assignees';
import { parseQueryInput } from '../parse-input';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const PERIODS = TargetPeriodSchema.options;
const METRICS = TargetMetricSchema.options;
/** The most callers one team lists. */
const MAX_CALLERS = 200;

/** Targets are for people; an agent has none. */
function requirePerson(ctx: Ctx): void {
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'targets are for people, not agents');
  }
}

function requireCompany(ctx: Ctx, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

type Starts = Record<TargetPeriod, string>;

/** The first day of the day, week and month that hold `now`. */
export function currentStarts(now: Date): Starts {
  return {
    day: periodStartOn('day', now),
    week: periodStartOn('week', now),
    month: periodStartOn('month', now),
  };
}

/** The first day of the period after each of `starts`. */
function nextStarts(starts: Starts): Starts {
  const next = (period: TargetPeriod): string =>
    periodStartOn(period, periodBounds(period, starts[period]).to);
  return { day: next('day'), week: next('week'), month: next('month') };
}

const keyOf = (subjectId: string, metric: string, period: string): string =>
  `${subjectId}|${metric}|${period}`;

const uuidArray = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;

interface TargetValueRow extends Record<string, unknown> {
  id: string;
  subject_id: string;
  set_at: Date | string;
  set_by: string;
  metric: TargetMetric;
  period: TargetPeriod;
  value: string;
  starts_on: string;
}

/**
 * The target in force for each subject, metric and period on the day `starts` names for the
 * period: the newest row (latest `starts_on` not after the period's first day, then the latest
 * `set_at`), RLS deciding which rows the reader sees. A value of 0 is "no target" and is left out.
 * Exported so the targets' plan can be read (`tests/spike/targets-explain.ts`).
 */
export function effectiveTargetsSql(
  entityId: number,
  scope: 'caller' | 'team',
  subjectIds: readonly string[],
  starts: Starts,
) {
  return sql`
    select distinct on (t.subject_id, t.metric, t.period)
           t.id, t.subject_id, t.metric, t.period, t.value::text as value,
           t.starts_on::text as starts_on, t.set_at, t.set_by
      from targets t
     where t.entity_id = ${entityId} and t.scope = ${scope}
       and t.subject_id = any(${uuidArray(subjectIds)})
       and ((t.period = 'day' and t.starts_on <= ${starts.day}::date)
         or (t.period = 'week' and t.starts_on <= ${starts.week}::date)
         or (t.period = 'month' and t.starts_on <= ${starts.month}::date))
     order by t.subject_id, t.metric, t.period, t.starts_on desc, t.set_at desc, t.id desc`;
}

async function effectiveTargets(
  ctx: Ctx,
  entityId: number,
  scope: 'caller' | 'team',
  subjectIds: readonly string[],
  starts: Starts,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (subjectIds.length === 0) return out;
  const rows = (await ctx.tx.execute(
    effectiveTargetsSql(entityId, scope, subjectIds, starts),
  )) as unknown as TargetValueRow[];
  for (const r of rows) {
    const value = Number(r.value);
    if (value > 0) out.set(keyOf(r.subject_id, r.metric, r.period), value);
  }
  return out;
}

export interface Actuals {
  calls: number;
  qualified: number;
  orders: number;
  kw: number;
}

const NONE: Actuals = { calls: 0, qualified: 0, orders: 0, kw: 0 };

/**
 * The actuals of `userIds` for one period (`app.target_actuals()`, the one place they are counted):
 * a caller's own, or a team lead's team. The database refuses anyone else.
 */
export function targetActualsSql(
  entityId: number,
  from: Date,
  to: Date,
  userIds: readonly string[],
) {
  return sql`
    select subject_id, calls_n, qualified_n, orders_n, kw_n::text as kw_n
      from app.target_actuals(${entityId}::smallint, ${from.toISOString()}::timestamptz,
                              ${to.toISOString()}::timestamptz, ${uuidArray(userIds)})`;
}

async function actualsOf(
  ctx: Ctx,
  entityId: number,
  period: TargetPeriod,
  startsOn: string,
  userIds: readonly string[],
): Promise<Map<string, Actuals>> {
  const out = new Map<string, Actuals>();
  if (userIds.length === 0) return out;
  const { from, to } = periodBounds(period, startsOn);
  const rows = (await ctx.tx.execute(targetActualsSql(entityId, from, to, userIds))) as unknown as {
    subject_id: string;
    calls_n: number;
    qualified_n: number;
    orders_n: number;
    kw_n: string;
  }[];
  for (const r of rows) {
    out.set(r.subject_id, {
      calls: r.calls_n,
      qualified: r.qualified_n,
      orders: r.orders_n,
      kw: Number(r.kw_n),
    });
  }
  return out;
}

function metricProgress(
  metric: TargetMetric,
  actuals: Actuals,
  target: number | undefined,
): MetricProgressDto {
  const actual = actuals[metric];
  return {
    metric,
    target: target ?? null,
    actual,
    fraction: progressFraction(actual, target ?? null),
  };
}

/**
 * The signed-in person's targets and how far they are, for today, this week and this month in
 * each company of the request: the caller's home. A metric with no target set shows no target;
 * the figures are the caller's own, counted by the database whether or not they can still read the
 * lead (a lead handed on since).
 */
export async function myProgress(
  ctx: Ctx,
  rawInput: unknown = {},
  now: Date = new Date(),
): Promise<MyProgressDto[]> {
  parseQueryInput(MyProgressInput, rawInput, 'targets.mine');
  requirePerson(ctx);
  const me = ctx.principal.id;
  const starts = currentStarts(now);
  const out: MyProgressDto[] = [];
  for (const entityId of ctx.entityIds) {
    const targets = await effectiveTargets(ctx, entityId, 'caller', [me], starts);
    const periods: PeriodProgressDto[] = [];
    for (const period of PERIODS) {
      const startsOn = starts[period];
      const hasTarget = METRICS.some((m) => targets.has(keyOf(me, m, period)));
      const actual = hasTarget
        ? ((await actualsOf(ctx, entityId, period, startsOn, [me])).get(me) ?? NONE)
        : NONE;
      periods.push({
        period,
        startsOn,
        endsOn: periodEndOn(period, startsOn),
        metrics: METRICS.map((m) => metricProgress(m, actual, targets.get(keyOf(me, m, period)))),
      });
    }
    out.push(MyProgressDto.parse({ entityId, periods }));
  }
  return out;
}

interface Member {
  id: string;
  name: string;
}

/** The people of a team in a company who log calls: the team lead's callers. */
async function teamCallers(ctx: Ctx, entityId: number, teamId: string): Promise<Member[]> {
  const uer = schema.userEntityRoles;
  const rp = schema.rolePermissions;
  const p = schema.principals;
  return ctx.tx
    .selectDistinct({ id: p.id, name: p.displayName })
    .from(uer)
    .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
    .innerJoin(rp, and(eq(rp.roleId, uer.roleId), eq(rp.permissionKey, 'calls.log')))
    .where(
      and(eq(uer.entityId, entityId), eq(uer.teamId, teamId), sql`app.user_is_active(${p.id})`),
    )
    .orderBy(asc(p.displayName), asc(p.id))
    .limit(MAX_CALLERS);
}

/**
 * The team lead's progress (`sales.targets.write` at team scope or wider): in each company where
 * the reader has a team, the team's target for each metric against the sum of its callers' figures
 * for the period, and a leaderboard of the callers ranked by `metric` (highest first, then by
 * name), each with their own target and figures.
 */
export async function teamProgress(
  ctx: Ctx,
  rawInput: unknown = {},
  now: Date = new Date(),
): Promise<TeamProgressDto[]> {
  const input = parseQueryInput(TeamProgressInput, rawInput, 'targets.team');
  requirePerson(ctx);
  checkPermission(ctx.principal, 'sales.targets.write', 'team');
  const entityIds = input.entityId === undefined ? [...ctx.entityIds] : [input.entityId];
  for (const e of entityIds) requireCompany(ctx, e);
  const starts = currentStarts(now);
  const startsOn = starts[input.period];
  const out: TeamProgressDto[] = [];
  for (const entityId of entityIds) {
    const teamId = teamIn(ctx, entityId);
    if (teamId === undefined) continue;
    const [team] = await ctx.tx
      .select({ name: schema.teams.name })
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .limit(1);
    const members = await teamCallers(ctx, entityId, teamId);
    const ids = members.map((m) => m.id);
    const [callerTargets, teamTargets, actuals] = await Promise.all([
      effectiveTargets(ctx, entityId, 'caller', ids, starts),
      effectiveTargets(ctx, entityId, 'team', [teamId], starts),
      actualsOf(ctx, entityId, input.period, startsOn, ids),
    ]);
    const sum: Actuals = { calls: 0, qualified: 0, orders: 0, kw: 0 };
    for (const a of actuals.values()) {
      sum.calls += a.calls;
      sum.qualified += a.qualified;
      sum.orders += a.orders;
      sum.kw += a.kw;
    }
    const leaderboard = members
      .map((m) => {
        const a = actuals.get(m.id) ?? NONE;
        return {
          callerId: m.id,
          callerName: m.name,
          metrics: METRICS.map((metric) =>
            metricProgress(metric, a, callerTargets.get(keyOf(m.id, metric, input.period))),
          ),
        };
      })
      .sort(
        (x, y) =>
          (actuals.get(y.callerId) ?? NONE)[input.metric] -
            (actuals.get(x.callerId) ?? NONE)[input.metric] ||
          x.callerName.localeCompare(y.callerName),
      )
      .map((row) => LeaderboardRowDto.parse(row));
    out.push(
      TeamProgressDto.parse({
        entityId,
        teamId,
        teamName: team?.name ?? '',
        period: input.period,
        startsOn,
        endsOn: periodEndOn(input.period, startsOn),
        metric: input.metric,
        team: METRICS.map((metric) =>
          metricProgress(metric, sum, teamTargets.get(keyOf(teamId, metric, input.period))),
        ),
        leaderboard,
      }),
    );
  }
  return out;
}

interface HistoryRow extends Record<string, unknown> {
  id: string;
  entity_id: number;
  scope: 'caller' | 'team';
  subject_id: string;
  subject_name: string | null;
  team_id: string;
  metric: TargetMetric;
  period: TargetPeriod;
  starts_on: string;
  value: string;
  set_at: Date | string;
  set_by_name: string | null;
}

/**
 * The newest targets set in a company, newest first, with who they are for and who set them. RLS
 * decides which rows the reader sees. Exported for the plan to be read.
 */
export function targetHistorySql(entityId: number, limit: number) {
  return sql`
    select t.id, t.entity_id, t.scope, t.subject_id,
           case when t.scope = 'team' then tm.name else sp.display_name end as subject_name,
           t.team_id, t.metric, t.period, t.starts_on::text as starts_on, t.value::text as value,
           t.set_at, bp.display_name as set_by_name
      from targets t
      left join teams tm on t.scope = 'team' and tm.id = t.subject_id
      left join principals sp on t.scope = 'caller' and sp.id = t.subject_id
      left join principals bp on bp.id = t.set_by
     where t.entity_id = ${entityId}
     order by t.set_at desc, t.id desc
     limit ${limit}`;
}

const toDto = (r: HistoryRow) => ({
  id: r.id,
  entityId: r.entity_id,
  scope: r.scope,
  subjectId: r.subject_id,
  subjectName: r.subject_name,
  teamId: r.team_id,
  metric: r.metric,
  period: r.period,
  startsOn: r.starts_on,
  value: Number(r.value),
  setAt: (r.set_at instanceof Date ? r.set_at : new Date(r.set_at)).toISOString(),
  setByName: r.set_by_name,
});

/**
 * The Targets page of one company (`sales.targets.write`): who a target can be set for (a team
 * lead: their team and its callers; the GM and the Executive: every team and every caller of the
 * company), the targets in force today, and the history of those set.
 */
export async function targetsScreen(
  ctx: Ctx,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<TargetsScreenDto> {
  const input = parseQueryInput(TargetsScreenInput, rawInput, 'targets.screen');
  requirePerson(ctx);
  checkPermission(ctx.principal, 'sales.targets.write', 'team');
  requireCompany(ctx, input.entityId);
  const entityId = input.entityId;
  const wide = hasGrant(ctx.principal.permissions, 'sales.targets.write', 'entity');
  const ownTeam = teamIn(ctx, entityId);
  const starts = currentStarts(now);

  const t = schema.teams;
  const teamRows =
    !wide && ownTeam === undefined
      ? []
      : await ctx.tx
          .select({ id: t.id, name: t.name })
          .from(t)
          .where(
            and(
              isNull(t.archivedAt),
              wide
                ? sql`(${t.entityId} is null or ${t.entityId} = ${entityId})`
                : eq(t.id, ownTeam ?? ''),
            ),
          )
          .orderBy(asc(t.name), asc(t.id));

  const uer = schema.userEntityRoles;
  const rp = schema.rolePermissions;
  const p = schema.principals;
  const callerRows =
    !wide && ownTeam === undefined
      ? []
      : await ctx.tx
          .selectDistinct({ id: p.id, name: p.displayName, teamId: uer.teamId })
          .from(uer)
          .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
          .innerJoin(rp, and(eq(rp.roleId, uer.roleId), eq(rp.permissionKey, 'calls.log')))
          .where(
            and(
              eq(uer.entityId, entityId),
              wide ? sql`${uer.teamId} is not null` : eq(uer.teamId, ownTeam ?? ''),
              sql`app.user_is_active(${p.id})`,
            ),
          )
          .orderBy(asc(p.displayName), asc(p.id))
          .limit(MAX_CALLERS);

  const subjects = [
    ...teamRows.map((r) => ({ scope: 'team' as const, id: r.id, name: r.name, teamId: r.id })),
    ...callerRows.flatMap((r) =>
      r.teamId === null
        ? []
        : [{ scope: 'caller' as const, id: r.id, name: r.name, teamId: r.teamId }],
    ),
  ];

  const nameOf = new Map(subjects.map((s) => [s.id, s.name]));
  const callerIds = subjects.filter((s) => s.scope === 'caller').map((s) => s.id);
  const teamIds = subjects.filter((s) => s.scope === 'team').map((s) => s.id);
  const [callerNow, teamNow, historyRows] = await Promise.all([
    effectiveRows(ctx, entityId, 'caller', callerIds, starts),
    effectiveRows(ctx, entityId, 'team', teamIds, starts),
    ctx.tx.execute(targetHistorySql(entityId, input.historyLimit)) as unknown as Promise<
      HistoryRow[]
    >,
  ]);
  const current = [...teamNow, ...callerNow]
    .filter((r) => Number(r.value) > 0)
    .map((r) =>
      toDto({
        ...r,
        entity_id: entityId,
        subject_name: nameOf.get(r.subject_id) ?? null,
        team_id: subjects.find((s) => s.id === r.subject_id)?.teamId ?? r.subject_id,
      }),
    );
  return TargetsScreenDto.parse({
    entityId,
    subjects,
    current,
    history: historyRows.map(toDto),
    periodStarts: starts,
    nextStarts: nextStarts(starts),
  });
}

type EffectiveRow = TargetValueRow & { scope: 'caller' | 'team'; set_by_name: string | null };

/** The targets in force with the facts a row of the page shows. */
async function effectiveRows(
  ctx: Ctx,
  entityId: number,
  scope: 'caller' | 'team',
  subjectIds: readonly string[],
  starts: Starts,
): Promise<EffectiveRow[]> {
  if (subjectIds.length === 0) return [];
  return (await ctx.tx.execute(sql`
    select e.id, ${scope}::text as scope, e.subject_id, e.metric, e.period, e.value, e.starts_on,
           e.set_at, bp.display_name as set_by_name
      from (${effectiveTargetsSql(entityId, scope, subjectIds, starts)}) e
      left join principals bp on bp.id = e.set_by
     order by e.subject_id, e.metric, e.period`)) as unknown as EffectiveRow[];
}

/** Used by the home pages to know which companies of the request have a team for the reader. */
export function teamsOfRequest(ctx: Ctx): { entityId: number; teamId: string }[] {
  return ctx.entityIds.flatMap((entityId) => {
    const teamId = teamIn(ctx, entityId);
    return teamId === undefined ? [] : [{ entityId, teamId }];
  });
}
