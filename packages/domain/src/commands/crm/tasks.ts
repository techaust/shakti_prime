import {
  CancelTaskInput,
  CompleteTaskInput,
  CreateTaskInput,
  DomainError,
  newId,
  RescheduleTaskInput,
  TaskDto,
  TaskStateSchema,
  type Scope,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { checkPermission } from '../../command/run-command';
import { holdLeadCustomer } from '../../crm/hold-customer';
import { transition } from '../../state-machines/define-machine';
import {
  taskMachine,
  type TaskEvent,
  type TaskParams,
  type TaskRecord,
} from '../../state-machines/machines/task';
import { requireEntity } from './opportunity-shared';

type TaskRow = typeof schema.tasks.$inferSelect;

/** The audited fields of a task. */
const TASK_FIELDS = ['taskKind', 'title', 'dueAt', 'state', 'doneAt'];

function toTaskDto(row: TaskRow): TaskDto {
  return TaskDto.parse({
    id: row.id,
    entityId: row.entityId,
    opportunityId: row.opportunityId,
    accountId: row.accountId,
    assigneeId: row.assigneeId,
    teamId: row.teamId,
    kind: row.kind,
    title: row.title,
    dueAt: row.dueAt.toISOString(),
    state: row.state,
    doneAt: row.doneAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function fireTask(
  ctx: CommandContext,
  record: TaskRecord,
  event: TaskEvent,
  params: TaskParams = {},
): void {
  transition(taskMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params,
  });
}

/**
 * The person a task is for, when it is not the caller: someone whose role in the company works on
 * leads, active there (`app.user_is_active()`), with their team there. The caller needs
 * `crm.lead.assign` at the scope that covers them: team scope for someone of the caller's own team,
 * company scope for anyone else.
 */
async function colleague(
  ctx: CommandContext,
  assigneeId: string,
  entityId: number,
): Promise<{ teamId: string | null }> {
  checkPermission(ctx.principal, 'crm.lead.assign', 'own');
  const uer = schema.userEntityRoles;
  const rp = schema.rolePermissions;
  const p = schema.principals;
  const [found] = await ctx.tx
    .select({ teamId: uer.teamId })
    .from(uer)
    .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
    .innerJoin(rp, and(eq(rp.roleId, uer.roleId), eq(rp.permissionKey, 'crm.lead.write')))
    .where(
      and(
        eq(uer.userId, assigneeId),
        eq(uer.entityId, entityId),
        sql`app.user_is_active(${uer.userId})`,
      ),
    )
    .limit(1);
  if (!found) {
    throw new DomainError('validation_failed', 'the person does not work on leads here', {
      reason: 'assignee_not_eligible',
    });
  }
  const sameTeam =
    found.teamId !== null &&
    ctx.principal.teamId !== undefined &&
    found.teamId === ctx.principal.teamId;
  const needed: Scope = sameTeam ? 'team' : 'entity';
  checkPermission(ctx.principal, 'crm.lead.assign', needed);
  return found;
}

/**
 * `crm.task.create` (docs/03-roadmap-appendix/phase1.md §6.5): a callback, follow-up, nurture or review on a lead
 * the caller may work on, due now or later, for the caller or for a colleague who works on leads
 * in that company (`colleague`). The row's write policy asks the caller's lead write scope to
 * cover the lead and the person the task is for.
 */
export const createTask = defineCommand({
  name: 'crm.task.create',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: CreateTaskInput,
  output: TaskDto,
  auditFields: TASK_FIELDS,
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    // The task names the lead's customer: a merge of it must not move the lead meanwhile.
    await holdLeadCustomer(ctx, input);
    const o = schema.opportunities;
    const [lead] = await ctx.tx
      .select({ id: o.id, accountId: o.accountId })
      .from(o)
      .where(
        and(eq(o.id, input.opportunityId), eq(o.entityId, input.entityId), isNull(o.archivedAt)),
      )
      .limit(1);
    if (!lead) {
      throw new DomainError('not_found', `opportunity ${input.opportunityId} is not visible`, {
        reason: 'lead_missing',
      });
    }
    const dueAt = new Date(input.dueAt);
    fireTask(ctx, { state: null }, 'create', { dueAt });

    const assigneeId = input.assigneeId ?? ctx.principal.id;
    const teamId =
      assigneeId === ctx.principal.id
        ? (ctx.principal.teamId ?? null)
        : (await colleague(ctx, assigneeId, input.entityId)).teamId;

    const [row] = await ctx.tx
      .insert(schema.tasks)
      .values({
        id: newId(),
        entityId: input.entityId,
        opportunityId: lead.id,
        accountId: lead.accountId,
        assigneeId,
        teamId,
        kind: input.kind,
        title: input.title ?? null,
        dueAt,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'task insert returned no row');

    ctx.audit({
      aggregateType: 'task',
      aggregateId: row.id,
      entityId: row.entityId,
      after: {
        opportunityId: row.opportunityId,
        assigneeId,
        teamId,
        taskKind: row.kind,
        title: row.title,
        dueAt: row.dueAt.toISOString(),
        state: row.state,
      },
    });
    await ctx.activity({
      type: 'task_created',
      opportunityId: row.opportunityId,
      accountId: row.accountId,
      entityId: row.entityId,
      payload: { taskId: row.id, kind: row.kind, dueAt: row.dueAt.toISOString(), assigneeId },
    });
    return toTaskDto(row);
  },
});

/** The task, locked for this transaction; one the caller cannot read is not found. */
async function lockTask(
  ctx: CommandContext,
  input: { entityId: number; taskId: string },
): Promise<TaskRow> {
  requireEntity(ctx, input.entityId);
  const t = schema.tasks;
  const [row] = await ctx.tx
    .select()
    .from(t)
    .where(and(eq(t.id, input.taskId), eq(t.entityId, input.entityId)))
    .limit(1)
    .for('update');
  if (!row) {
    throw new DomainError('not_found', `task ${input.taskId} is not visible`, {
      reason: 'task_missing',
    });
  }
  return row;
}

/** The one write of a task change; the update policy asks the caller's write scope over it. */
async function writeTask(
  ctx: CommandContext,
  row: TaskRow,
  change: Partial<Pick<TaskRow, 'state' | 'doneAt' | 'dueAt'>>,
): Promise<TaskRow> {
  const t = schema.tasks;
  const [updated] = await ctx.tx
    .update(t)
    .set({ ...change, updatedBy: ctx.principal.id })
    .where(eq(t.id, row.id))
    .returning();
  if (!updated) {
    throw new DomainError('forbidden', `task ${row.id} is outside the caller's write scope`);
  }
  return updated;
}

function record(row: TaskRow): TaskRecord {
  return { state: TaskStateSchema.parse(row.state) };
}

/** `crm.task.complete`: an open task is done, now. */
export const completeTask = defineCommand({
  name: 'crm.task.complete',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: CompleteTaskInput,
  output: TaskDto,
  auditFields: TASK_FIELDS,
  async handler(ctx, input) {
    const row = await lockTask(ctx, input);
    fireTask(ctx, record(row), 'complete');
    const updated = await writeTask(ctx, row, { state: 'done', doneAt: ctx.now });
    ctx.audit({
      aggregateType: 'task',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: updated.state, doneAt: ctx.now.toISOString() },
    });
    await ctx.activity({
      type: 'task_done',
      opportunityId: row.opportunityId,
      accountId: row.accountId,
      entityId: row.entityId,
      payload: { taskId: row.id, kind: row.kind },
    });
    return toTaskDto(updated);
  },
});

/** `crm.task.reschedule`: an open task moves to another due time, now or later. */
export const rescheduleTask = defineCommand({
  name: 'crm.task.reschedule',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: RescheduleTaskInput,
  output: TaskDto,
  auditFields: TASK_FIELDS,
  async handler(ctx, input) {
    const row = await lockTask(ctx, input);
    const dueAt = new Date(input.dueAt);
    fireTask(ctx, record(row), 'reschedule', { dueAt });
    const updated = await writeTask(ctx, row, { dueAt });
    ctx.audit({
      aggregateType: 'task',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { dueAt: row.dueAt.toISOString() },
      after: { dueAt: dueAt.toISOString() },
    });
    await ctx.activity({
      type: 'task_rescheduled',
      opportunityId: row.opportunityId,
      accountId: row.accountId,
      entityId: row.entityId,
      payload: { taskId: row.id, kind: row.kind, dueAt: dueAt.toISOString() },
    });
    return toTaskDto(updated);
  },
});

/** `crm.task.cancel`: an open task is no longer needed. */
export const cancelTask = defineCommand({
  name: 'crm.task.cancel',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: CancelTaskInput,
  output: TaskDto,
  auditFields: TASK_FIELDS,
  async handler(ctx, input) {
    const row = await lockTask(ctx, input);
    fireTask(ctx, record(row), 'cancel');
    const updated = await writeTask(ctx, row, { state: 'cancelled' });
    ctx.audit({
      aggregateType: 'task',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: updated.state },
    });
    await ctx.activity({
      type: 'task_cancelled',
      opportunityId: row.opportunityId,
      accountId: row.accountId,
      entityId: row.entityId,
      payload: { taskId: row.id, kind: row.kind },
    });
    return toTaskDto(updated);
  },
});
