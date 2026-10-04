import { z } from 'zod';
import { TaskKindSchema, TaskStateSchema } from '../../crm/enums';
import { EntityIdSchema, IdSchema } from '../../ids';

/** A short label a person gives a task, beside its kind. */
const TaskTitle = z.string().trim().min(1).max(80);

/**
 * `crm.task.create`: a callback, follow-up, nurture or review due at a time, on a lead of the
 * company, for the caller or (with `crm.lead.assign`) for a colleague who works there.
 */
export const CreateTaskInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    kind: TaskKindSchema,
    dueAt: z.iso.datetime({ offset: true }),
    /** Left out for the caller's own task. */
    assigneeId: IdSchema.optional(),
    title: TaskTitle.optional(),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

const TaskRef = { entityId: EntityIdSchema, taskId: IdSchema };

/** `crm.task.complete`: an open task is done. */
export const CompleteTaskInput = z.object(TaskRef).strict();
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;

/** `crm.task.reschedule`: an open task moves to another due time. */
export const RescheduleTaskInput = z
  .object({ ...TaskRef, dueAt: z.iso.datetime({ offset: true }) })
  .strict();
export type RescheduleTaskInput = z.infer<typeof RescheduleTaskInput>;

/** `crm.task.cancel`: an open task is no longer needed. */
export const CancelTaskInput = z.object(TaskRef).strict();
export type CancelTaskInput = z.infer<typeof CancelTaskInput>;

/** A task as the task commands and lists answer it. Strict. */
export const TaskDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    accountId: IdSchema,
    assigneeId: IdSchema,
    teamId: IdSchema.nullable(),
    kind: TaskKindSchema,
    title: z.string().nullable(),
    dueAt: z.iso.datetime(),
    state: TaskStateSchema,
    doneAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type TaskDto = z.infer<typeof TaskDto>;
