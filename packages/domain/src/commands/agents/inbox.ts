import {
  AgentRoleKeySchema,
  DomainError,
  EditInboxItemInput,
  InboxDecisionDto,
  InboxItemDoneDto,
  InboxItemRefInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { actionTypeOf, applyEdits, wasEdited } from '../../ai/action-types';
import { loadAgentConfig, lockAgentSettings } from '../../ai/config';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { transition } from '../../state-machines/define-machine';
import { agentActionMachine } from '../../state-machines/machines/agent-action';
import { inboxItemMachine } from '../../state-machines/machines/inbox-item';
import { requireEntity } from '../crm/opportunity-shared';

type ItemRow = typeof schema.inboxItems.$inferSelect;
type ActionRow = typeof schema.agentActions.$inferSelect;

/**
 * The suggestion, locked, and its action; one the caller cannot read is not found. Every decision
 * locks the item first, so two decisions on one suggestion take turns and the second is refused.
 */
async function lockSuggestion(
  ctx: CommandContext,
  input: { entityId: number; itemId: string },
): Promise<{ item: ItemRow; action: ActionRow }> {
  requireEntity(ctx, input.entityId);
  const i = schema.inboxItems;
  const [item] = await ctx.tx
    .select()
    .from(i)
    .where(and(eq(i.id, input.itemId), eq(i.entityId, input.entityId)))
    .limit(1)
    .for('update');
  if (!item?.agentActionId) {
    throw new DomainError('not_found', `inbox item ${input.itemId} is not visible`, {
      reason: 'inbox_item_missing',
    });
  }
  const a = schema.agentActions;
  const [action] = await ctx.tx
    .select()
    .from(a)
    .where(and(eq(a.id, item.agentActionId), eq(a.entityId, item.entityId)))
    .limit(1);
  if (!action) throw new DomainError('internal', `inbox item ${item.id} has no action`);
  return { item, action };
}

/**
 * Fires the decision on both machines: a decided suggestion is refused as already decided. A
 * Needs approval suggestion is approved or rejected; a Suggest one, which a person acts on
 * themselves, is only dismissed (BLUEPRINT §9.3).
 */
function decide(
  ctx: CommandContext,
  item: ItemRow,
  action: ActionRow,
  event: 'approve' | 'reject' | 'dismiss',
): void {
  const suggestOnly = action.autonomy === 'suggest';
  if (suggestOnly !== (event === 'dismiss')) {
    throw new DomainError(
      'conflict',
      `a ${action.autonomy} suggestion cannot be met with ${event}`,
      { reason: suggestOnly ? 'agent_suggestion_only' : 'agent_needs_decision' },
    );
  }
  const actor = { kind: 'principal' as const, principal: ctx.principal };
  transition(inboxItemMachine, { state: item.state as 'open' | 'done' }, 'decide', {
    actor,
    now: ctx.now,
    params: {},
  });
  transition(
    agentActionMachine,
    { state: action.state as 'proposed' | 'executed' | 'approved' | 'rejected' | 'dismissed' },
    event,
    { actor, now: ctx.now, params: {} },
  );
}

/** Records the decision on the action and closes its inbox item. */
async function record(
  ctx: CommandContext,
  item: ItemRow,
  action: ActionRow,
  decision: {
    state: 'approved' | 'rejected' | 'dismissed';
    edited: boolean;
    input?: Record<string, unknown>;
  },
): Promise<InboxDecisionDto> {
  const a = schema.agentActions;
  await ctx.tx
    .update(a)
    .set({
      state: decision.state,
      edited: decision.edited,
      decidedInputJson: decision.input ?? null,
      decidedBy: ctx.principal.id,
      decidedAt: ctx.now,
    })
    .where(eq(a.id, action.id));
  const i = schema.inboxItems;
  await ctx.tx
    .update(i)
    .set({ state: 'done', doneBy: ctx.principal.id, doneAt: ctx.now, updatedBy: ctx.principal.id })
    .where(eq(i.id, item.id));
  ctx.audit({
    aggregateType: 'agent_action',
    aggregateId: action.id,
    entityId: action.entityId,
    before: { state: action.state },
    after: { state: decision.state, edited: decision.edited },
  });
  ctx.audit({
    aggregateType: 'inbox_item',
    aggregateId: item.id,
    entityId: item.entityId,
    before: { state: item.state },
    after: { state: 'done' },
  });
  return { itemId: item.id, actionId: action.id, state: decision.state, edited: decision.edited };
}

/**
 * Runs the suggested command as the person who decides, under their own permissions and in this
 * transaction, never as the agent; refused while a kill switch stops the agent (PRD AI-04). The
 * settings lock holds the switches still until the decision commits. Counted as edited only when
 * an editable field changed, a time compared as an instant.
 */
async function approve(
  ctx: CommandContext,
  input: { entityId: number; itemId: string },
  changes: Readonly<Record<string, string>> | undefined,
): Promise<InboxDecisionDto> {
  const { item, action } = await lockSuggestion(ctx, input);
  decide(ctx, item, action, 'approve');
  const type = actionTypeOf(action.actionType);
  const agent = AgentRoleKeySchema.parse(action.agent);
  await lockAgentSettings(ctx.tx, agent);
  const config = await loadAgentConfig(ctx.tx, agent, action.actionType, action.entityId);
  if (!config.enabled) {
    throw new DomainError('conflict', `${agent} is switched off`, { reason: 'agent_switched_off' });
  }
  const proposed = action.inputJson as Record<string, unknown>;
  const runInput = changes === undefined ? proposed : applyEdits(type, proposed, changes);
  const edited = wasEdited(type, proposed, runInput);
  await ctx.run(type.command, edited ? runInput : proposed);
  return record(ctx, item, action, {
    state: 'approved',
    edited,
    ...(edited ? { input: runInput } : {}),
  });
}

/** The fields of a decision the Activity log names. */
const DECISION_FIELDS = ['state', 'edited'];

/** `agents.inbox.approve`: a Needs approval suggestion runs as it was proposed. */
export const approveInboxItem = defineCommand({
  name: 'agents.inbox.approve',
  permission: 'agents.inbox.act',
  minScope: 'own',
  peopleOnly: true,
  input: InboxItemRefInput,
  output: InboxDecisionDto,
  auditFields: DECISION_FIELDS,
  handler: (ctx, input) => approve(ctx, input, undefined),
});

/**
 * `agents.inbox.edit`: the suggestion runs with the fields its action type lets a person change,
 * and is counted as edited when anything changed (the record behind Automatic, BLUEPRINT §9.3).
 */
export const editInboxItem = defineCommand({
  name: 'agents.inbox.edit',
  permission: 'agents.inbox.act',
  minScope: 'own',
  peopleOnly: true,
  input: EditInboxItemInput,
  output: InboxDecisionDto,
  auditFields: DECISION_FIELDS,
  handler: (ctx, input) => approve(ctx, input, input.changes),
});

/** `agents.inbox.reject`: nothing runs; a Needs approval suggestion is closed as rejected. */
export const rejectInboxItem = defineCommand({
  name: 'agents.inbox.reject',
  permission: 'agents.inbox.act',
  minScope: 'own',
  peopleOnly: true,
  input: InboxItemRefInput,
  output: InboxDecisionDto,
  auditFields: DECISION_FIELDS,
  async handler(ctx, input) {
    const { item, action } = await lockSuggestion(ctx, input);
    decide(ctx, item, action, 'reject');
    return record(ctx, item, action, { state: 'rejected', edited: false });
  },
});

/**
 * `agents.inbox.dismiss`: a Suggest suggestion leaves the inbox; nothing runs. The person acts on
 * it themselves, from the lead or customer it is about, or chooses not to (BLUEPRINT §9.3).
 */
export const dismissInboxItem = defineCommand({
  name: 'agents.inbox.dismiss',
  permission: 'agents.inbox.act',
  minScope: 'own',
  peopleOnly: true,
  input: InboxItemRefInput,
  output: InboxDecisionDto,
  auditFields: DECISION_FIELDS,
  async handler(ctx, input) {
    const { item, action } = await lockSuggestion(ctx, input);
    decide(ctx, item, action, 'dismiss');
    return record(ctx, item, action, { state: 'dismissed', edited: false });
  },
});

/**
 * `agents.inbox.complete`: routed work (an enquiry passed on because the person looks after the
 * customer, docs/design/phase1.md §8.1) leaves the inbox once its person, or whoever acts on their
 * inbox, has dealt with it. A suggestion is decided with the commands above instead.
 */
export const completeInboxItem = defineCommand({
  name: 'agents.inbox.complete',
  permission: 'agents.inbox.act',
  minScope: 'own',
  peopleOnly: true,
  input: InboxItemRefInput,
  output: InboxItemDoneDto,
  auditFields: ['state'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const i = schema.inboxItems;
    const [item] = await ctx.tx
      .select()
      .from(i)
      .where(and(eq(i.id, input.itemId), eq(i.entityId, input.entityId), eq(i.kind, 'routed_work')))
      .limit(1)
      .for('update');
    if (item === undefined) {
      throw new DomainError('not_found', `inbox item ${input.itemId} is not visible`, {
        reason: 'inbox_item_missing',
      });
    }
    transition(inboxItemMachine, { state: item.state as 'open' | 'done' }, 'complete', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: {},
    });
    await ctx.tx
      .update(i)
      .set({
        state: 'done',
        doneBy: ctx.principal.id,
        doneAt: ctx.now,
        updatedBy: ctx.principal.id,
      })
      .where(eq(i.id, item.id));
    ctx.audit({
      aggregateType: 'inbox_item',
      aggregateId: item.id,
      entityId: item.entityId,
      before: { state: item.state },
      after: { state: 'done' },
    });
    return { itemId: item.id, state: 'done' as const };
  },
});
