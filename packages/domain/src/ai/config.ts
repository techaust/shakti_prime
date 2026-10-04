import type { AgentAutonomy, AgentRoleKey } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { DEFAULT_AUTONOMY } from './action-types';
import type { SpendCap } from './provider';

// How the settings of `agent_configs` apply to one agent, action type and company (docs/design/
// phase1.md §7.1, BLUEPRINT §9.3): a kill switch that is off at any level (every agent, the agent,
// the company, the action type) stops the agent; autonomy and the spend cap come from the most
// specific row that sets them.

export interface AgentConfigRow {
  agent: string | null;
  actionType: string | null;
  entityId: number | null;
  autonomy: string | null;
  dailySpendCapPaise: number | null;
  enabled: boolean;
}

export interface ResolvedAgentConfig {
  enabled: boolean;
  autonomy: AgentAutonomy;
  /** No cap set means the agent may not call a model at all. */
  cap: SpendCap | null;
}

/** How specific a matching row is: its action type counts above its company. */
const specificity = (row: AgentConfigRow): number =>
  (row.actionType === null ? 0 : 2) + (row.entityId === null ? 0 : 1);

export function resolveAgentConfig(
  rows: readonly AgentConfigRow[],
  agent: AgentRoleKey,
  actionType: string,
  entityId: number,
): ResolvedAgentConfig {
  const matching = rows.filter(
    (r) =>
      (r.agent === null || r.agent === agent) &&
      (r.actionType === null || r.actionType === actionType) &&
      (r.entityId === null || r.entityId === entityId),
  );
  const mostSpecific = [...matching].sort((a, b) => specificity(b) - specificity(a));
  const autonomy = mostSpecific.find((r) => r.agent === agent && r.autonomy !== null)?.autonomy;
  const capRow = mostSpecific.find(
    (r) => r.agent === agent && r.actionType === null && r.dailySpendCapPaise !== null,
  );
  return {
    enabled: matching.every((r) => r.enabled),
    autonomy: (autonomy as AgentAutonomy | undefined) ?? DEFAULT_AUTONOMY,
    cap:
      capRow?.dailySpendCapPaise == null
        ? null
        : { paise: capRow.dailySpendCapPaise, entityId: capRow.entityId },
  };
}

/** The rows that can apply to one agent and action type in one company, read under RLS. */
export async function loadAgentConfigRows(
  tx: RequestTx,
  agent: AgentRoleKey,
  actionType: string,
  entityId: number,
): Promise<AgentConfigRow[]> {
  const c = schema.agentConfigs;
  return tx
    .select({
      agent: c.agent,
      actionType: c.actionType,
      entityId: c.entityId,
      autonomy: c.autonomy,
      dailySpendCapPaise: c.dailySpendCapPaise,
      enabled: c.enabled,
    })
    .from(c)
    .where(
      and(
        or(isNull(c.agent), eq(c.agent, agent)),
        or(isNull(c.actionType), eq(c.actionType, actionType)),
        or(isNull(c.entityId), eq(c.entityId, entityId)),
      ),
    );
}

/** The resolved settings for one agent, action type and company. */
export async function loadAgentConfig(
  tx: RequestTx,
  agent: AgentRoleKey,
  actionType: string,
  entityId: number,
): Promise<ResolvedAgentConfig> {
  return resolveAgentConfig(
    await loadAgentConfigRows(tx, agent, actionType, entityId),
    agent,
    actionType,
    entityId,
  );
}
