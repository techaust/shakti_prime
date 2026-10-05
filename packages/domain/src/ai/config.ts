import type { AgentAutonomy, AgentRoleKey, AgentSettingSource } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DEFAULT_AUTONOMY } from './action-types';
import type { SpendCap } from './provider';

// How the settings of `agent_configs` apply to one agent, action type and company (docs/design/
// phase1.md §7.1, BLUEPRINT §9.3): a kill switch that is off at any level (every agent, the agent,
// the company, the action type) stops the agent; autonomy comes from the most specific row that
// sets it; the company's cap and the group's cap both apply, so a call is refused if it would pass
// either.

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
  /** Where the autonomy comes from. */
  autonomySource: AgentSettingSource;
  /** Every cap that applies: the company's, the group's, or both. None means no calls at all. */
  caps: SpendCap[];
}

/** How specific a matching row is: its action type counts above its company. */
const specificity = (row: AgentConfigRow): number =>
  (row.actionType === null ? 0 : 2) + (row.entityId === null ? 0 : 1);

/** Where a row's setting comes from, as the agents screen names it. */
export function sourceOf(row: Pick<AgentConfigRow, 'actionType' | 'entityId'>): AgentSettingSource {
  if (row.actionType === null) return row.entityId === null ? 'agent_group' : 'agent_company';
  return row.entityId === null ? 'action_group' : 'action_company';
}

/** The autonomy that applies, from the most specific row of the agent's own that sets one. */
export function appliedAutonomy(
  rows: readonly AgentConfigRow[],
  agent: AgentRoleKey,
  actionType: string,
  entityId: number,
): { autonomy: AgentAutonomy; source: AgentSettingSource } {
  const found = rows
    .filter(
      (r) =>
        r.agent === agent &&
        r.autonomy !== null &&
        (r.actionType === null || r.actionType === actionType) &&
        (r.entityId === null || r.entityId === entityId),
    )
    .sort((a, b) => specificity(b) - specificity(a))[0];
  return found === undefined
    ? { autonomy: DEFAULT_AUTONOMY, source: 'default' }
    : { autonomy: found.autonomy as AgentAutonomy, source: sourceOf(found) };
}

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
  const applied = appliedAutonomy(matching, agent, actionType, entityId);
  const caps = matching
    .filter((r) => r.agent === agent && r.actionType === null && r.dailySpendCapPaise !== null)
    .map((r) => ({ paise: r.dailySpendCapPaise ?? 0, entityId: r.entityId }))
    .sort((a, b) => (a.entityId === null ? 1 : 0) - (b.entityId === null ? 1 : 0));
  return {
    enabled: matching.every((r) => r.enabled),
    autonomy: applied.autonomy,
    autonomySource: applied.source,
    caps,
  };
}

/** The key of the lock the agent settings take for one agent, or (null) for every agent. */
const settingLock = (agent: string | null): string => `agent-config:${agent ?? '*'}`;

/**
 * Holds the agent's settings still for the rest of the transaction: a decision or a run that acts
 * on them takes the shared lock for every agent and for the agent, and a change of a setting or a
 * switch takes the exclusive lock of its own, so a switch turned off waits for, or is seen by,
 * every decision in flight (docs/design/phase1.md §7.1).
 */
export async function lockAgentSettings(tx: RequestTx, agent: AgentRoleKey): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${settingLock(null)}, 0)),
               pg_advisory_xact_lock_shared(hashtextextended(${settingLock(agent)}, 0))`,
  );
}

/** The exclusive lock a change of one agent's settings, or every agent's (null), takes. */
export async function lockAgentSettingsForChange(
  tx: RequestTx,
  agent: string | null,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${settingLock(agent)}, 0))`);
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
