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
import { AGENT_ACTION_TYPES, automaticEarned } from '../../ai/action-types';
import { resolveAgentConfig, type AgentConfigRow } from '../../ai/config';
import { istDay } from '../../ai/provider';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** A company id no company has: resolving at it applies only the group's settings. */
const GROUP_LEVEL = 0;

/** Midnight IST of the day `at` falls on, as a UTC moment. */
function istMidnight(at: Date): Date {
  return new Date(`${istDay(at)}T00:00:00+05:30`);
}

/**
 * The agents screen (`/admin/agents`): every agent at one level, the company the request is
 * narrowed to or (null) the group, with its switch and whether any switch stops it there, its
 * autonomy and daily spend cap, what it spent today (from its runs), and for each action type the
 * autonomy that applies and the record behind Automatic. Opens with either agent control.
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
  const at = (agent: string | null, actionType: string | null) =>
    rows.find((r) => r.agent === agent && r.actionType === actionType && r.entityId === level);

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
  const records = await ctx.tx
    .select({
      agent: a.agent,
      actionType: a.actionType,
      decided: sql<number>`count(*) filter (where ${a.state} in ('approved', 'rejected'))::int`,
      approvedUnedited: sql<number>`count(*) filter (where ${a.state} = 'approved' and not ${a.edited})::int`,
    })
    .from(a)
    .where(level === null ? inArray(a.entityId, [...ctx.entityIds]) : eq(a.entityId, level))
    .groupBy(a.agent, a.actionType);

  const resolveAt = level ?? GROUP_LEVEL;
  return AgentSettingsDto.parse({
    entityId: level,
    allEnabled: at(null, null)?.enabled ?? true,
    agents: AGENT_ROLE_KEYS.map((agent: AgentRoleKey) => {
      const own = at(agent, null);
      const spent = spend.find((s) => s.agent === agent);
      return {
        agent,
        enabled: own?.enabled ?? true,
        stopped: !resolveAgentConfig(rows, agent, '', resolveAt).enabled,
        autonomy: (own?.autonomy as AgentAutonomy | null | undefined) ?? null,
        dailySpendCapPaise: own?.dailySpendCapPaise ?? null,
        spentTodayPaise: Number(spent?.paise ?? 0),
        runsToday: spent?.runs ?? 0,
        actionTypes: Object.values(AGENT_ACTION_TYPES)
          .filter((t) => t.agents.includes(agent))
          .map((t) => {
            const record = records.find(
              (x) => x.agent === agent && x.actionType === t.command.name,
            );
            const decided = record?.decided ?? 0;
            const approvedUnedited = record?.approvedUnedited ?? 0;
            return {
              actionType: t.command.name,
              autonomy: (at(agent, t.command.name)?.autonomy as AgentAutonomy | undefined) ?? null,
              effectiveAutonomy: resolveAgentConfig(rows, agent, t.command.name, resolveAt)
                .autonomy,
              decided,
              approvedUnedited,
              automaticEarned: automaticEarned(decided, approvedUnedited),
            };
          }),
      };
    }),
  });
}
