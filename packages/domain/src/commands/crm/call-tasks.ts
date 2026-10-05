import { DomainError, type TaskDto, type TaskKind } from '@shakti/contracts';
import type { CommandContext } from '../../command/context';
import { nurtureCallTimes } from '../../telecom/call-schedule';
import type { OpportunityRow } from './opportunity-shared';
import { createTask } from './tasks';

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
  kind: Extract<TaskKind, 'callback' | 'nurture'>,
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
      if (!(e instanceof DomainError) || (e.code !== 'forbidden' && e.code !== 'validation_failed')) {
        throw e;
      }
    }
  }
  return ctx.run(createTask, input);
}

/**
 * The nurture calls of a lead that has just entered nurture (CALL-5, the owner's default of
 * 05-10-2026): one task each on day 7, 30 and 90, at the start of that day's calling hours.
 */
export async function scheduleNurtureCalls(
  ctx: CommandContext,
  lead: Pick<OpportunityRow, 'id' | 'entityId' | 'ownerId'>,
): Promise<TaskDto[]> {
  const tasks: TaskDto[] = [];
  for (const dueAt of nurtureCallTimes(ctx.now)) {
    tasks.push(await createCallTask(ctx, lead, 'nurture', dueAt));
  }
  return tasks;
}
