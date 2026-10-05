import {
  AgentRunDto,
  DomainError,
  newId,
  RecordAgentRunInput,
  type AgentRunOutcome,
  type PermissionKey,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import {
  AGENT_ACTION_TYPES,
  actionTypeOf,
  withAssignee,
  type AgentActionType,
} from '../../ai/action-types';
import { loadAgentConfig, lockAgentSettings } from '../../ai/config';
import type { CommandContext } from '../../command/context';
import { defineCommand, type Requirement } from '../../command/define-command';
import { isAgent } from '../../command/run-command';
import { transition } from '../../state-machines/define-machine';
import { agentActionMachine } from '../../state-machines/machines/agent-action';
import { inboxItemMachine } from '../../state-machines/machines/inbox-item';
import { requireEntity } from '../crm/opportunity-shared';

/** The permission of the command an action type runs, which the agent must hold itself. */
export function actionRequirement(type: AgentActionType): Requirement {
  const permission = type.command.permission;
  if (typeof permission !== 'string') {
    throw new DomainError('internal', `${type.command.name} names its permission by input`);
  }
  return { permission, minScope: type.command.minScope ?? 'own' };
}

const ACTION_PERMISSIONS: PermissionKey[] = [
  ...new Set(Object.values(AGENT_ACTION_TYPES).map((t) => actionRequirement(t).permission)),
];

/** What the run's model work and the settings make of it. */
type Plan = 'record_only' | 'propose' | 'act';

/**
 * `agents.run.record` (docs/design/phase1.md §7.1): an agent records one run for one action type
 * as its own principal: which model, the tokens, the cost in paise, how long it took and how it
 * ended, never the prompt or the answer. When the model work completed with an action, the
 * settings in this transaction, held still by the settings lock, decide: a kill switch that is off
 * records the run as stopped; Suggest and Needs approval file the action with an inbox item;
 * Automatic runs the command as the agent, under its own permissions, at once. Automatic is not
 * available in Phase 1 (`AUTOMATIC_AVAILABLE`): a stored Automatic resolves, and files, as Needs
 * approval (`appliedAutonomy()`).
 *
 * The permission is the one of the command the action runs, so an agent proposes nothing it could
 * not do itself; only the agent named in the input may record its run.
 */
export const recordAgentRun = defineCommand({
  name: 'agents.run.record',
  permission: {
    keys: ACTION_PERMISSIONS,
    of: (input: RecordAgentRunInput) => {
      const type = Object.hasOwn(AGENT_ACTION_TYPES, input.actionType)
        ? AGENT_ACTION_TYPES[input.actionType]
        : undefined;
      return type === undefined ? null : actionRequirement(type);
    },
  },
  input: RecordAgentRunInput,
  output: AgentRunDto,
  auditFields: ['agent', 'actionType', 'autonomy', 'state', 'outcome'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (!isAgent(ctx.principal) || ctx.principal.roleKey !== input.agent) {
      throw new DomainError('forbidden', 'only the agent itself records its run');
    }
    const type = actionTypeOf(input.actionType);
    if (!type.agents.includes(input.agent)) {
      throw new DomainError('forbidden', `${input.agent} does not take ${input.actionType}`, {
        reason: 'agent_action_not_open',
      });
    }

    let outcome: AgentRunOutcome = input.ended === 'completed' ? 'nothing_to_do' : input.ended;
    let plan: Plan = 'record_only';
    let autonomy: 'suggest' | 'needs_approval' | 'automatic' = 'suggest';
    if (input.proposal !== undefined) {
      await lockAgentSettings(ctx.tx, input.agent);
      const config = await loadAgentConfig(ctx.tx, input.agent, input.actionType, input.entityId);
      // A stored Automatic resolves as Needs approval while it is not available (`appliedAutonomy`).
      autonomy = config.autonomy;
      if (!config.enabled) outcome = 'switched_off';
      else {
        plan = autonomy === 'automatic' ? 'act' : 'propose';
        outcome = plan === 'act' ? 'acted' : 'proposed';
      }
    }

    const runId = newId();
    // The agent cannot read its runs back (agent_runs_read), so nothing is returned.
    await ctx.tx.insert(schema.agentRuns).values({
      id: runId,
      entityId: input.entityId,
      agent: input.agent,
      principalId: ctx.principal.id,
      purpose: input.purpose,
      actionType: input.actionType,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costPaise: input.costPaise,
      outcome,
      durationMs: input.durationMs,
      requestId: ctx.requestId,
    });
    ctx.audit({
      aggregateType: 'agent_run',
      aggregateId: runId,
      entityId: input.entityId,
      after: { agent: input.agent, actionType: input.actionType, outcome },
    });

    const proposal = input.proposal;
    if (plan === 'record_only' || proposal === undefined) {
      return { runId, outcome, actionId: null, inboxItemId: null };
    }
    const proposed = await checkedProposal(ctx, type, input.entityId, proposal);

    const requirement = actionRequirement(type);
    const actor = { kind: 'principal' as const, principal: ctx.principal };
    transition(agentActionMachine, { state: null }, 'propose', {
      actor,
      now: ctx.now,
      params: {},
      requirement,
    });
    if (plan === 'act') {
      transition(agentActionMachine, { state: 'proposed' }, 'execute', {
        actor,
        now: ctx.now,
        params: {},
        requirement,
      });
      // As the agent, under its own permissions: the command's guard and the policies decide.
      await ctx.run(type.command, proposed.input);
    }

    const actionId = newId();
    const state = plan === 'act' ? 'executed' : 'proposed';
    await ctx.tx.insert(schema.agentActions).values({
      id: actionId,
      entityId: input.entityId,
      runId,
      agent: input.agent,
      actionType: input.actionType,
      inputJson: proposed.input,
      autonomy,
      state,
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'agent_action',
      aggregateId: actionId,
      entityId: input.entityId,
      after: { agent: input.agent, actionType: input.actionType, autonomy, state },
    });
    if (plan === 'act') return { runId, outcome, actionId, inboxItemId: null };

    transition(inboxItemMachine, { state: null }, 'file', {
      actor,
      now: ctx.now,
      params: {},
      requirement,
    });
    const itemId = newId();
    await ctx.tx.insert(schema.inboxItems).values({
      id: itemId,
      entityId: input.entityId,
      kind: 'agent_suggestion',
      assigneeId: proposed.assigneeId,
      teamId: proposed.teamId,
      subjectType: proposed.subjectType,
      subjectId: proposed.subjectId,
      state: 'open',
      agentActionId: actionId,
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'inbox_item',
      aggregateId: itemId,
      entityId: input.entityId,
      after: { state: 'open', agentActionId: actionId },
    });
    return { runId, outcome, actionId, inboxItemId: itemId };
  },
});

/** Whether the agent itself reads the subject in the run's company, under its own policies. */
async function subjectReadable(
  ctx: CommandContext,
  subjectType: string,
  subjectId: string,
  entityId: number,
): Promise<boolean> {
  if (subjectType === 'opportunity') {
    const o = schema.opportunities;
    const [row] = await ctx.tx
      .select({ id: o.id })
      .from(o)
      .where(and(eq(o.id, subjectId), eq(o.entityId, entityId), isNull(o.archivedAt)))
      .limit(1);
    return row !== undefined;
  }
  const ae = schema.accountEntities;
  const [row] = await ctx.tx
    .select({ id: ae.accountId })
    .from(ae)
    .where(and(eq(ae.accountId, subjectId), eq(ae.entityId, entityId)))
    .limit(1);
  return row !== undefined;
}

/**
 * The proposal's input as the command it runs reads it, in the run's company, about a subject the
 * agent reads there, with the person the work is for filled in or named (never an agent); anything
 * else is refused before it reaches anyone's inbox.
 */
async function checkedProposal(
  ctx: CommandContext,
  type: AgentActionType,
  entityId: number,
  proposal: NonNullable<RecordAgentRunInput['proposal']>,
): Promise<{
  input: Record<string, unknown>;
  subjectType: string;
  subjectId: string;
  assigneeId: string | null;
  /** The assignee's team in the company, from their role there. */
  teamId: string | null;
}> {
  const refused = () =>
    new DomainError('validation_failed', `${ctx.principal.roleKey} proposed a bad input`, {
      reason: 'agent_proposal_invalid',
    });
  const input = withAssignee(type, proposal.input, proposal.assigneeId);
  if (input === undefined) throw refused();
  const parsed = type.command.input.safeParse(input);
  if (
    !parsed.success ||
    input.entityId !== entityId ||
    input[type.subjectKey] !== proposal.subjectId ||
    proposal.subjectType !== type.subjectType
  ) {
    throw refused();
  }
  if (!(await subjectReadable(ctx, proposal.subjectType, proposal.subjectId, entityId))) {
    throw refused();
  }
  const named = type.assigneeKey === undefined ? undefined : input[type.assigneeKey];
  const assigneeId = proposal.assigneeId ?? (typeof named === 'string' ? named : null);
  const member =
    assigneeId === null ? { teamId: null } : await companyMember(ctx, assigneeId, entityId);
  if (member === undefined) throw refused();
  return {
    input,
    subjectType: proposal.subjectType,
    subjectId: proposal.subjectId,
    assigneeId,
    teamId: member.teamId,
  };
}

/**
 * The person's place in the company, when they are a person (never an agent or the workers), not
 * archived, and hold a role there: the inbox item takes their team there, never the agent's word.
 */
async function companyMember(
  ctx: CommandContext,
  personId: string,
  entityId: number,
): Promise<{ teamId: string | null } | undefined> {
  const p = schema.principals;
  const uer = schema.userEntityRoles;
  const [row] = await ctx.tx
    .select({ teamId: uer.teamId })
    .from(uer)
    .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
    .where(and(eq(uer.userId, personId), eq(uer.entityId, entityId)))
    .limit(1);
  return row;
}
