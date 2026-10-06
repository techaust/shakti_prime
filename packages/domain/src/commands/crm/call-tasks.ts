import { DomainError, type TaskDto, type TaskKind } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { nurtureCallTimes } from '../../telecom/call-schedule';
import type { OpportunityRow } from './opportunity-shared';
import { cancelTask, createTask } from './tasks';

type CallTaskKind = Extract<TaskKind, 'callback' | 'nurture'>;
type LeadRef = Pick<OpportunityRow, 'id' | 'entityId'>;

/**
 * The call tasks the calling rules set on a lead (docs/design/phase1.md §7.2): a callback, a retry
 * and the nurture calls. Each is for the lead's owner, who works its calls, made through
 * `crm.task.create` as the caller, so it is audited and on the timeline like any task. When the
 * caller may not set a task for the owner (no `crm.lead.assign` over them, or the owner no longer
 * works on leads in the company), the task is the caller's own instead, so the next call is never
 * lost.
 */
export async function createCallTask(
  ctx: CommandContext,
  lead: Pick<OpportunityRow, 'id' | 'entityId' | 'ownerId'>,
  kind: CallTaskKind,
  dueAt: Date,
): Promise<TaskDto> {
  const input = {
    entityId: lead.entityId,
    opportunityId: lead.id,
    kind,
    dueAt: dueAt.toISOString(),
  };
  const owner = lead.ownerId;
  if (owner !== null && owner !== ctx.principal.id) {
    try {
      return await ctx.savepoint((tx) =>
        ctx.run(createTask, { ...input, assigneeId: owner }, { tx }),
      );
    } catch (e) {
      // Only the refusals of setting a task for someone else fall back; anything else fails.
      if (
        !(e instanceof DomainError) ||
        (e.code !== 'forbidden' && e.code !== 'validation_failed')
      ) {
        throw e;
      }
    }
  }
  return ctx.run(createTask, input);
}

/**
 * The lead's open call tasks of `kinds` that the caller may change: those whose person their own
 * lead write scope covers, as the task update policy asks. `except` leaves out one person's.
 */
async function openCallTasks(
  ctx: CommandContext,
  lead: LeadRef,
  kinds: readonly CallTaskKind[],
  options: { dueAfter?: Date; except?: string } = {},
) {
  const t = schema.tasks;
  return ctx.tx
    .select({ id: t.id, kind: t.kind, dueAt: t.dueAt, title: t.title, assigneeId: t.assigneeId })
    .from(t)
    .where(
      and(
        eq(t.opportunityId, lead.id),
        eq(t.entityId, lead.entityId),
        eq(t.state, 'open'),
        inArray(t.kind, [...kinds]),
        options.dueAfter === undefined ? undefined : gt(t.dueAt, options.dueAfter),
        options.except === undefined ? undefined : ne(t.assigneeId, options.except),
        sql`app.scope_ok('crm.lead.write', ${t.assigneeId}, ${t.teamId})`,
      ),
    )
    .orderBy(t.dueAt, t.id);
}

/**
 * Cancels the lead's open call tasks of `kinds` (only those due after `dueAfter`, when given),
 * each through `crm.task.cancel`, so it is audited and on the timeline. The lead's nurture calls
 * end when it leaves nurture (`crm.opportunity.reopen` and `crm.opportunity.lose`, and so a call
 * that takes it out), and its callbacks when it is lost; `calls.call.log` cancels a later callback
 * its outcome replaces. A task the caller may not change (another person's, outside their write
 * scope) is left; the queue reads only the owner's.
 */
export async function cancelCallTasks(
  ctx: CommandContext,
  lead: LeadRef,
  kinds: readonly CallTaskKind[],
  dueAfter?: Date,
): Promise<number> {
  const open = await openCallTasks(ctx, lead, kinds, dueAfter === undefined ? {} : { dueAfter });
  for (const task of open) {
    await ctx.run(cancelTask, { entityId: lead.entityId, taskId: task.id });
  }
  return open.length;
}

/**
 * Moves the lead's open callbacks and nurture calls to its new owner (`crm.opportunity.assign`),
 * so the time the customer asked for travels with the lead. A task's person is not a column the
 * app may change (0078's grant), so each moves as a new task for the new owner at the same time
 * (or now, when it is already due), through `crm.task.create`, and the old one is cancelled
 * through `crm.task.cancel`; both are audited and on the timeline.
 */
export async function moveCallTasks(
  ctx: CommandContext,
  lead: LeadRef,
  ownerId: string,
): Promise<number> {
  const open = await openCallTasks(ctx, lead, ['callback', 'nurture'], { except: ownerId });
  for (const task of open) {
    const dueAt = new Date(Math.max(task.dueAt.getTime(), ctx.now.getTime()));
    await ctx.run(createTask, {
      entityId: lead.entityId,
      opportunityId: lead.id,
      kind: task.kind,
      dueAt: dueAt.toISOString(),
      ...(ownerId === ctx.principal.id ? {} : { assigneeId: ownerId }),
      ...(task.title === null ? {} : { title: task.title }),
    });
    await ctx.run(cancelTask, { entityId: lead.entityId, taskId: task.id });
  }
  return open.length;
}

/**
 * The nurture calls of a lead that has just entered nurture (CALL-5, the owner's default of
 * 05-10-2026): one task each on day 7, 30 and 90, at the start of that day's calling hours. Any
 * nurture call still open on the lead is cancelled first, so the lead has one set.
 */
export async function scheduleNurtureCalls(
  ctx: CommandContext,
  lead: Pick<OpportunityRow, 'id' | 'entityId' | 'ownerId'>,
): Promise<TaskDto[]> {
  await cancelCallTasks(ctx, lead, ['nurture']);
  const tasks: TaskDto[] = [];
  for (const dueAt of nurtureCallTimes(ctx.now)) {
    tasks.push(await createCallTask(ctx, lead, 'nurture', dueAt));
  }
  return tasks;
}
