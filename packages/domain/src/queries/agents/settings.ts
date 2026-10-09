import {
  AGENT_ROLE_KEYS,
  AgentSettingsDto,
  DomainError,
  hasGrant,
  type AgentAutonomy,
  type AgentRoleKey,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { AGENT_ACTION_TYPES, AUTOMATIC_AVAILABLE } from '../../ai/action-types';
import { AGENT_DEFAULTS } from '../../ai/agent-defaults';
import { appliedAutonomy, resolveAgentConfig, type AgentConfigRow } from '../../ai/config';
import { istDay } from '../../ai/provider';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** A company id no company has: resolving at it applies only the group's settings. */
const GROUP_LEVEL = 0;

/** Midnight IST of the day `at` falls on, as a UTC moment. */
function istMidnight(at: Date): Date {
  return new Date(`${istDay(at)}T00:00:00+05:30`);
}

/** An action type no setting names: resolving at it applies only the agent's own rows. */
const NO_ACTION_TYPE = '';

/**
 * The agents screen (`/admin/agents`): every agent at one level, the company the request is
 * narrowed to or (null) the group, with its switch and whether any switch stops it there; its
 * autonomy, the autonomy that applies and where it comes from, and what the empty choice would
 * inherit; its daily spend cap and, at a company, the group's cap, which applies as well; what it
 * spent today (from its runs); and for each action type the same autonomies and the decisions the
 * promotion rule counts in its window. Opens with either agent control.
 */
export async function loadAgentSettings(
  ctx: Ctx,
  options: { now?: Date } = {},
): Promise<AgentSettingsDto> {
  const perms = ctx.principal.permissions;
  if (
    !hasGrant(perms, 'agents.killswitch', 'all') &&
    !hasGrant(perms, 'agents.autonomy.write', 'all')
  ) {
    throw new DomainError('forbidden', 'the agents screen needs an agent control');
  }
  const level = ctx.entityIds.length === 1 ? (ctx.entityIds[0] ?? null) : null;
  const c = schema.agentConfigs;
  const rows: AgentConfigRow[] = (
    await ctx.tx
      .select({
        agent: c.agent,
        actionType: c.actionType,
        entityId: c.entityId,
        autonomy: c.autonomy,
        dailySpendCapPaise: c.dailySpendCapPaise,
        enabled: c.enabled,
      })
      .from(c)
  ).filter((r) => r.entityId === null || r.entityId === level);
  const at = (agent: string | null, actionType: string | null, entityId = level) =>
    rows.find((r) => r.agent === agent && r.actionType === actionType && r.entityId === entityId);

  const r = schema.agentRuns;
  const spend = await ctx.tx
    .select({
      agent: r.agent,
      // A bigint comes back as text.
      paise: sql<string>`coalesce(sum(${r.costPaise}), 0)::bigint`,
      runs: sql<number>`count(*)::int`,
    })
    .from(r)
    .where(
      and(
        inArray(r.entityId, [...ctx.entityIds]),
        gte(r.createdAt, istMidnight(options.now ?? new Date())),
      ),
    )
    .groupBy(r.agent);

  const a = schema.agentActions;
  const rule = AGENT_DEFAULTS.promotion;
  const since = new Date((options.now ?? new Date()).getTime() - rule.windowDays * 86_400_000);
  const records = await ctx.tx
    .select({
      agent: a.agent,
      actionType: a.actionType,
      decided: sql<number>`count(*) filter (where ${a.state} in ('approved', 'rejected'))::int`,
      approvedUnedited: sql<number>`count(*) filter (where ${a.state} = 'approved' and not ${a.edited})::int`,
    })
    .from(a)
    .where(
      and(
        level === null ? inArray(a.entityId, [...ctx.entityIds]) : eq(a.entityId, level),
        eq(a.autonomy, rule.countedAutonomy),
        inArray(a.state, ['approved', 'rejected']),
        gte(a.decidedAt, since),
      ),
    )
    .groupBy(a.agent, a.actionType);

  const resolveAt = level ?? GROUP_LEVEL;
  /** What applies with, and without, the row at this level for the agent and action type. */
  const applied = (agent: AgentRoleKey, actionType: string | null) => {
    const name = actionType ?? NO_ACTION_TYPE;
    const here = at(agent, actionType);
    return {
      effective: appliedAutonomy(rows, agent, name, resolveAt),
      inherited: appliedAutonomy(
        rows.filter((r) => r !== here),
        agent,
        name,
        resolveAt,
      ),
    };
  };
  return AgentSettingsDto.parse({
    entityId: level,
    allEnabled: at(null, null)?.enabled ?? true,
    automaticAvailable: AUTOMATIC_AVAILABLE,
    agents: AGENT_ROLE_KEYS.map((agent: AgentRoleKey) => {
      const own = at(agent, null);
      const spent = spend.find((s) => s.agent === agent);
      const group = level === null ? undefined : at(agent, null, null);
      return {
        agent,
        enabled: own?.enabled ?? true,
        stopped: !resolveAgentConfig(rows, agent, NO_ACTION_TYPE, resolveAt).enabled,
        autonomy: (own?.autonomy as AgentAutonomy | null | undefined) ?? null,
        ...applied(agent, null),
        dailySpendCapPaise: own?.dailySpendCapPaise ?? null,
        groupCapPaise: group?.dailySpendCapPaise ?? null,
        spentTodayPaise: Number(spent?.paise ?? 0),
        runsToday: spent?.runs ?? 0,
        actionTypes: Object.values(AGENT_ACTION_TYPES)
          .filter((t) => t.agents.includes(agent))
          .map((t) => {
            const record = records.find((x) => x.agent === agent && x.actionType === t.name);
            return {
              actionType: t.name,
              shadowOnly: t.command === undefined,
              autonomy: (at(agent, t.name)?.autonomy as AgentAutonomy | undefined) ?? null,
              ...applied(agent, t.name),
              decided: record?.decided ?? 0,
              approvedUnedited: record?.approvedUnedited ?? 0,
            };
          }),
      };
    }),
  });
}
