import {
  AgentRunDto,
  DomainError,
  newId,
  RecordAgentRunInput,
  type AgentRunOutcome,
  type PermissionKey,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { AGENT_ACTION_TYPES, actionTypeOf, type AgentActionType } from '../../ai/action-types';
import { loadAgentConfig } from '../../ai/config';
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
 * settings in this transaction decide: a kill switch that is off records the run as stopped;
 * Suggest and Needs approval file the action with an inbox item; Automatic runs the command as the
 * agent, under its own permissions, at once.
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
      const config = await loadAgentConfig(ctx.tx, input.agent, input.actionType, input.entityId);
      autonomy = config.autonomy;
      if (!config.enabled) outcome = 'switched_off';
      else {
        plan = config.autonomy === 'automatic' ? 'act' : 'propose';
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
    const proposed = checkedProposal(ctx, type, input.entityId, proposal);

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
      assigneeId: proposal.assigneeId ?? null,
      teamId: proposal.teamId ?? null,
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

/**
 * The proposal's input as the command it runs reads it, in the run's company, about the subject it
 * names; anything else is refused before it reaches anyone's inbox.
 */
function checkedProposal(
  ctx: CommandContext,
  type: AgentActionType,
  entityId: number,
  proposal: NonNullable<RecordAgentRunInput['proposal']>,
): { input: Record<string, unknown>; subjectType: string; subjectId: string } {
  const parsed = type.command.input.safeParse(proposal.input);
  const input = proposal.input;
  if (
    !parsed.success ||
    input.entityId !== entityId ||
    input[type.subjectKey] !== proposal.subjectId ||
    proposal.subjectType !== type.subjectType
  ) {
    throw new DomainError('validation_failed', `${ctx.principal.roleKey} proposed a bad input`, {
      reason: 'agent_proposal_invalid',
    });
  }
  return { input, subjectType: proposal.subjectType, subjectId: proposal.subjectId };
}
