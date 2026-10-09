import {
  AGENT_ROLE_KEYS,
  AgentNameSchema,
  type AgentRoleKey,
  type AgentSpend,
  type IntegrationHealthResponse,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { istDay } from '../../ai/provider';
import { moneyFromPaise } from '../../money/paise';

type Ctx = Pick<RequestContext, 'tx' | 'entityIds'>;

// AI spend per agent for Integration health (docs/03-roadmap-appendix/phase1.md §9, A1; the PRD's
// Integration health criterion "AI spend per agent joins it with the Triage agent"): for each agent and company
// of the request, today's and this month's spend and runs (IST) from `agent_runs`, beside the
// caps `agent_configs` sets for the agent there and for the group. Read under the viewer's
// policies: the runs with the agent controls (`agent_runs_read`).

const rupees = (paise: bigint | number | string): string => moneyFromPaise(BigInt(paise));

/** An agent's role key as Integration health names it (`agent:triage` is `triage`). */
function agentName(key: string) {
  const parsed = AgentNameSchema.safeParse(key.replace(/^agent:/, ''));
  return parsed.success ? parsed.data : undefined;
}

export async function readAgentSpend(
  ctx: Ctx,
  now: Date = new Date(),
): Promise<IntegrationHealthResponse['aiSpend']> {
  const day = istDay(now);
  const dayStart = `${day}T00:00:00+05:30`;
  const monthStart = `${day.slice(0, 8)}01T00:00:00+05:30`;
  const ids = [...ctx.entityIds];
  const runs = (await ctx.tx.execute(sql`
    select r.agent, r.entity_id,
           coalesce(sum(r.cost_paise) filter (where r.created_at >= ${dayStart}::timestamptz), 0)::text as today,
           coalesce(sum(r.cost_paise), 0)::text as month,
           (count(*) filter (where r.created_at >= ${dayStart}::timestamptz))::int as runs_today,
           count(*)::int as runs_month,
           coalesce(bool_or(r.outcome = 'cap_reached' and r.created_at >= ${dayStart}::timestamptz), false) as stopped
      from agent_runs r
     where r.entity_id = any(${ids}::smallint[]) and r.created_at >= ${monthStart}::timestamptz
     group by r.agent, r.entity_id`)) as unknown as {
    agent: string;
    entity_id: number;
    today: string;
    month: string;
    runs_today: number;
    runs_month: number;
    stopped: boolean;
  }[];
  const caps = (await ctx.tx.execute(sql`
    select c.agent, c.entity_id, c.daily_spend_cap_paise::text as cap
      from agent_configs c
     where c.agent is not null and c.action_type is null and c.daily_spend_cap_paise is not null
       and (c.entity_id is null or c.entity_id = any(${ids}::smallint[]))`)) as unknown as {
    agent: string;
    entity_id: number | null;
    cap: string;
  }[];
  const capOf = (agent: string, entityId: number | null) =>
    caps.find((c) => c.agent === agent && c.entity_id === entityId)?.cap;

  const byAgent: AgentSpend[] = [];
  for (const agent of AGENT_ROLE_KEYS as readonly AgentRoleKey[]) {
    const name = agentName(agent);
    if (name === undefined) continue;
    for (const entityId of [...ids].sort((a, b) => a - b)) {
      const run = runs.find((r) => r.agent === agent && r.entity_id === entityId);
      const cap = capOf(agent, entityId);
      const groupCap = capOf(agent, null);
      // An agent that has neither run here this month nor a limit here is left out.
      if (run === undefined && cap === undefined) continue;
      byAgent.push({
        agent: name,
        entityId,
        today: rupees(run?.today ?? 0),
        monthToDate: rupees(run?.month ?? 0),
        runsToday: run?.runs_today ?? 0,
        runsMonthToDate: run?.runs_month ?? 0,
        dailyCap: cap === undefined ? null : rupees(cap),
        groupDailyCap: groupCap === undefined ? null : rupees(groupCap),
        stoppedByCap: run?.stopped ?? false,
      });
    }
  }
  const total = (key: 'today' | 'month') =>
    rupees(runs.reduce((sum, r) => sum + BigInt(r[key]), 0n));
  return { today: total('today'), monthToDate: total('month'), byAgent };
}
