import {
  CALLBACK_MAX_DAYS,
  DispositionNextActionSchema,
  DomainError,
  LogCallInput,
  LogCallResultDto,
  newId,
  OpportunityStateSchema,
  SegmentSchema,
  type DispositionNextAction,
  type LogCallResultDto as LogCallResult,
  type OpportunityState,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { callConsentWithdrawn } from '../../queries/calls/consent';
import { effectiveDispositions } from '../../queries/crm/pipeline-settings';
import { afterUnanswered, unansweredAttempts } from '../../telecom/call-schedule';
import { withinCallingHours } from '../../telecom/dial-policy';
import { cancelCallTasks, createCallTask } from '../crm/call-tasks';
import { loseOpportunity } from '../crm/lose-opportunity';
import { moveOpportunityStage } from '../crm/move-opportunity-stage';
import { nurtureOpportunity } from '../crm/nurture-opportunity';
import { lockOpportunity, requireEntity, type OpportunityRow } from '../crm/opportunity-shared';
import { reopenOpportunity } from '../crm/reopen-opportunity';
import { completeTask } from '../crm/tasks';

const DAY_MS = 86_400_000;

/** The stage a qualified lead moves to, which asks for the handover (TEL-02). */
const QUALIFIED_STAGE = 'qualified';

function refuse(code: 'validation_failed' | 'conflict', reason: string, message: string): never {
  throw new DomainError(code, message, { reason });
}

/** What the outcome needs beyond itself, checked before anything is written. */
function checkOutcomeInput(
  ctx: CommandContext,
  nextAction: DispositionNextAction,
  input: LogCallInput,
  state: OpportunityState,
): Date | undefined {
  if (nextAction === 'callback') {
    if (input.callbackAt === undefined) {
      refuse('validation_failed', 'callback_time_missing', 'a callback needs a time');
    }
    const at = new Date(input.callbackAt);
    if (at.getTime() <= ctx.now.getTime()) {
      refuse('validation_failed', 'callback_in_past', 'a callback is set in the future');
    }
    if (at.getTime() > ctx.now.getTime() + CALLBACK_MAX_DAYS * DAY_MS) {
      refuse('validation_failed', 'callback_too_far', 'a callback is set within 90 days');
    }
    if (!withinCallingHours(at)) {
      refuse('validation_failed', 'callback_outside_calling_hours', 'a callback is in hours');
    }
    return at;
  }
  if (
    (nextAction === 'not_interested' || nextAction === 'wrong_number') &&
    input.lostReason === undefined
  ) {
    refuse('validation_failed', 'lost_reason_missing', 'a lost lead needs its reason');
  }
  if (nextAction === 'nurture' && state === 'open' && input.nurtureReason === undefined) {
    refuse('validation_failed', 'nurture_reason_missing', 'a nurtured lead needs its reason');
  }
  return undefined;
}

/** The lead's latest call and the outcome it had, for the retry rule. */
async function lastCall(ctx: CommandContext, opportunityId: string) {
  const c = schema.calls;
  const d = schema.callDispositions;
  const [row] = await ctx.tx
    .select({ attemptNo: c.attemptNo, nextAction: d.nextAction, startedAt: c.startedAt })
    .from(c)
    .innerJoin(d, eq(d.id, c.dispositionId))
    .where(eq(c.opportunityId, opportunityId))
    .orderBy(desc(c.startedAt), desc(c.id))
    .limit(1);
  return row;
}

/** When the current run of unanswered attempts began: its latest first attempt. */
async function runStartedAt(ctx: CommandContext, opportunityId: string): Promise<Date | undefined> {
  const c = schema.calls;
  const [row] = await ctx.tx
    .select({ startedAt: c.startedAt })
    .from(c)
    .where(and(eq(c.opportunityId, opportunityId), eq(c.attemptNo, 1)))
    .orderBy(desc(c.startedAt), desc(c.id))
    .limit(1);
  return row?.startedAt;
}

/**
 * The call tasks this call answers: a due callback or nurture call of the caller or the lead's
 * owner is done; a later callback is cancelled (`cancelCallTasks`), since the outcome sets the next
 * step. Later nurture calls end when the outcome takes the lead out of nurture, in
 * `crm.opportunity.reopen` or `crm.opportunity.lose`.
 */
async function settleCallTasks(ctx: CommandContext, lead: OpportunityRow): Promise<void> {
  const t = schema.tasks;
  const people = [...new Set([ctx.principal.id, ...(lead.ownerId === null ? [] : [lead.ownerId])])];
  const due = await ctx.tx
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.opportunityId, lead.id),
        eq(t.entityId, lead.entityId),
        eq(t.state, 'open'),
        inArray(t.kind, ['callback', 'nurture']),
        inArray(t.assigneeId, people),
        lte(t.dueAt, ctx.now),
      ),
    );
  for (const task of due) {
    await ctx.run(completeTask, { entityId: lead.entityId, taskId: task.id });
  }
  await cancelCallTasks(ctx, lead, ['callback'], ctx.now);
}

/** The pipeline's qualified stage, live, with its position. */
async function qualifiedStage(
  ctx: CommandContext,
  pipelineId: string,
): Promise<{ id: string; position: number }> {
  const ps = schema.pipelineStages;
  const [stage] = await ctx.tx
    .select({ id: ps.id, position: ps.position })
    .from(ps)
    .where(and(eq(ps.pipelineId, pipelineId), eq(ps.key, QUALIFIED_STAGE), isNull(ps.archivedAt)))
    .limit(1);
  if (!stage) {
    throw new DomainError('validation_failed', `pipeline ${pipelineId} has no qualified stage`, {
      reason: 'stage_missing',
    });
  }
  return stage;
}

/** Whether the stage comes before `qualified` in its pipeline, as the queue's first stages do. */
async function before(
  ctx: CommandContext,
  stageId: string,
  qualified: { position: number },
): Promise<boolean> {
  const ps = schema.pipelineStages;
  const [stage] = await ctx.tx
    .select({ position: ps.position })
    .from(ps)
    .where(eq(ps.id, stageId))
    .limit(1);
  if (!stage) throw new DomainError('internal', `stage ${stageId} is not visible`);
  return stage.position < qualified.position;
}

/**
 * `calls.call.log` (docs/03-roadmap-appendix/phase1.md §7.2, PRD TEL-01), under the permission `calls.log`:
 * a person records a call they just made by hand to a lead (`number_series` `manual`, as every Phase 1 call is), with an outcome of the
 * lead's list (`effectiveDispositions`), and the command does what the outcome's next step says:
 * - `callback`: a callback task at the time the caller picks, inside calling hours;
 * - `retry`: the next attempt on its day at the start of calling hours, and after the last
 *   unanswered attempt the lead moves to nurture, whose calls are set as tasks (CALL-3 and CALL-5,
 *   the owner's defaults of 05-10-2026 in `WORKSHOP_DEFAULTS.calling`);
 * - `qualified`: the stage move to Qualified through `crm.opportunity.stage.move`, with its exit
 *   rules, which asks for the handover; a lead already at Qualified or past it keeps its stage;
 * - `not_interested` and `wrong_number`: the lead is lost with the reason the caller gives;
 * - `nurture`: the lead is parked with its reason.
 * A nurtured lead called on its nurture call is opened again for a callback or a qualified
 * outcome; other outcomes leave it in nurture or lose it. Each step runs through its own command
 * in this transaction, so it is guarded, audited and on the timeline as when done by hand.
 * Refused outside calling hours (`outside_calling_hours`) and for a customer who withdrew consent
 * to calls (`call_consent_withdrawn`). For people only.
 */
export const logCall = defineCommand({
  name: 'calls.call.log',
  permission: 'calls.log',
  minScope: 'own',
  peopleOnly: true,
  input: LogCallInput,
  output: LogCallResultDto,
  auditFields: ['callOutcome', 'nextAction', 'attemptNo', 'durationSeconds'],
  async handler(ctx, input): Promise<LogCallResult> {
    requireEntity(ctx, input.entityId);
    const lead = await lockOpportunity(ctx, input);
    const state = OpportunityStateSchema.parse(lead.state);
    if (state !== 'open' && state !== 'nurture') {
      refuse('conflict', 'call_lead_closed', `lead ${lead.id} is ${state}`);
    }
    if (!withinCallingHours(ctx.now)) {
      refuse('validation_failed', 'outside_calling_hours', 'calls are logged in calling hours');
    }
    if (await callConsentWithdrawn(ctx.tx, lead.accountId)) {
      refuse('conflict', 'call_consent_withdrawn', 'the customer withdrew consent to calls');
    }

    const [pipeline] = await ctx.tx
      .select({ segment: schema.pipelines.segment })
      .from(schema.pipelines)
      .where(eq(schema.pipelines.id, lead.pipelineId))
      .limit(1);
    if (!pipeline) throw new DomainError('internal', `pipeline ${lead.pipelineId} is not visible`);
    const outcomes = await effectiveDispositions(
      ctx,
      lead.entityId,
      SegmentSchema.parse(pipeline.segment),
    );
    const outcome = outcomes.dispositions.find((d) => d.id === input.dispositionId);
    if (!outcome) {
      refuse('validation_failed', 'disposition_not_offered', 'the outcome is not on the list');
    }
    const nextAction = DispositionNextActionSchema.parse(outcome.nextAction);
    const callbackAt = checkOutcomeInput(ctx, nextAction, input, state);

    const attemptNo = unansweredAttempts(await lastCall(ctx, lead.id), lead.stateChangedAt) + 1;
    const durationS = input.durationSeconds ?? null;
    const startedAt = new Date(ctx.now.getTime() - (durationS ?? 0) * 1000);
    const callId = newId();
    const [call] = await ctx.tx
      .insert(schema.calls)
      .values({
        id: callId,
        entityId: lead.entityId,
        opportunityId: lead.id,
        callerId: ctx.principal.id,
        direction: 'outbound',
        numberSeries: 'manual',
        dispositionId: outcome.id,
        attemptNo,
        startedAt,
        durationS,
      })
      .returning();
    if (!call) throw new DomainError('internal', 'call insert returned no row');
    ctx.audit({
      aggregateType: 'call',
      aggregateId: call.id,
      entityId: call.entityId,
      after: {
        opportunityId: lead.id,
        dispositionId: outcome.id,
        callOutcome: outcome.code,
        nextAction,
        attemptNo,
        durationSeconds: durationS,
      },
    });
    await ctx.activity({
      type: 'call_logged',
      opportunityId: lead.id,
      accountId: lead.accountId,
      entityId: lead.entityId,
      payload: {
        callId: call.id,
        dispositionId: outcome.id,
        code: outcome.code,
        nextAction,
        attemptNo,
      },
    });

    await settleCallTasks(ctx, lead);

    const ref = { entityId: lead.entityId, opportunityId: lead.id };
    let now = { state: state as OpportunityState, stageId: lead.stageId };
    const track = (dto: { state: OpportunityState; stageId: string }) => {
      now = { state: dto.state, stageId: dto.stageId };
    };
    let nextCall: LogCallResult['nextCall'] = null;
    let attemptsUsedUp = false;

    // A nurtured lead that answers is opened again, which ends its nurture calls.
    if (state === 'nurture' && (nextAction === 'callback' || nextAction === 'qualified')) {
      track(await ctx.run(reopenOpportunity, ref));
    }
    switch (nextAction) {
      case 'callback': {
        if (callbackAt === undefined) throw new DomainError('internal', 'callback time checked');
        const task = await createCallTask(ctx, lead, 'callback', callbackAt);
        nextCall = { kind: task.kind, dueAt: task.dueAt };
        break;
      }
      case 'retry': {
        // A nurtured lead keeps its nurture calls; only an open lead runs the retry rule.
        if (state !== 'open') break;
        const firstAt =
          attemptNo === 1 ? startedAt : ((await runStartedAt(ctx, lead.id)) ?? startedAt);
        const step = afterUnanswered(attemptNo, firstAt, ctx.now);
        if (step.kind === 'retry') {
          const task = await createCallTask(ctx, lead, 'callback', step.dueAt);
          nextCall = { kind: task.kind, dueAt: task.dueAt };
        } else {
          track(await ctx.run(nurtureOpportunity, { ...ref, reasonCode: 'not_reachable' }));
          attemptsUsedUp = true;
          nextCall = await firstNurtureCall(ctx, lead);
        }
        break;
      }
      case 'qualified': {
        // Only forwards: a lead at Qualified or past it has had its handover asked for already.
        const qualified = await qualifiedStage(ctx, lead.pipelineId);
        if (await before(ctx, now.stageId, qualified)) {
          track(await ctx.run(moveOpportunityStage, { ...ref, stageId: qualified.id }));
        }
        break;
      }
      case 'not_interested':
      case 'wrong_number': {
        if (input.lostReason === undefined) throw new DomainError('internal', 'reason checked');
        track(await ctx.run(loseOpportunity, { ...ref, reasonCode: input.lostReason }));
        break;
      }
      case 'nurture': {
        if (state === 'open') {
          if (input.nurtureReason === undefined) {
            throw new DomainError('internal', 'reason checked');
          }
          track(await ctx.run(nurtureOpportunity, { ...ref, reasonCode: input.nurtureReason }));
          nextCall = await firstNurtureCall(ctx, lead);
        }
        break;
      }
    }

    return LogCallResultDto.parse({
      call: {
        id: call.id,
        entityId: call.entityId,
        opportunityId: call.opportunityId,
        callerId: call.callerId,
        direction: call.direction,
        numberSeries: call.numberSeries,
        dispositionId: call.dispositionId,
        attemptNo: call.attemptNo,
        startedAt: call.startedAt.toISOString(),
        durationS: call.durationS,
      },
      nextAction,
      leadState: now.state,
      stageId: now.stageId,
      nextCall,
      attemptsUsedUp,
    });
  },
});

/** The first open nurture call on the lead, which the nurture command has just set. */
async function firstNurtureCall(
  ctx: CommandContext,
  lead: OpportunityRow,
): Promise<LogCallResult['nextCall']> {
  const t = schema.tasks;
  const [task] = await ctx.tx
    .select({ dueAt: t.dueAt })
    .from(t)
    .where(
      and(
        eq(t.opportunityId, lead.id),
        eq(t.entityId, lead.entityId),
        eq(t.kind, 'nurture'),
        eq(t.state, 'open'),
      ),
    )
    .orderBy(t.dueAt)
    .limit(1);
  return task === undefined ? null : { kind: 'nurture', dueAt: task.dueAt.toISOString() };
}
