import { defineMachine, type Guard } from '../define-machine';

export const TASK_STATES = ['open', 'done', 'cancelled'] as const;
export type TaskMachineState = (typeof TASK_STATES)[number];
export type TaskEvent = 'create' | 'complete' | 'reschedule' | 'cancel';

/** What the task commands preload for the guards. */
export interface TaskRecord {
  state: TaskMachineState | null;
}

export interface TaskParams {
  /** The new due time, for `create` and `reschedule`. */
  dueAt?: Date;
}

type G = Guard<TaskRecord, TaskParams>;

/** A due time a minute in the past still counts as now: a form takes a moment to send. */
const GRACE_MS = 60_000;

const dueAhead: G = {
  description: 'the due time is not in the past',
  check: (_record, { now, params }) =>
    params.dueAt !== undefined && params.dueAt.getTime() >= now.getTime() - GRACE_MS
      ? undefined
      : { code: 'validation_failed', reason: 'task_due_in_past' },
};

/** A callback, follow-up, nurture or review task on a lead (docs/design/phase1.md §6.5). */
export const taskMachine = defineMachine<TaskMachineState, TaskEvent, TaskRecord, TaskParams>({
  name: 'task',
  title: 'Task',
  summary:
    '`tasks.state`. A callback, follow-up, nurture or review due at a time, on a lead, for one person. Scope follows the person the task is for: own, team or company on `crm.lead.write`.',
  sources: ['docs/design/phase1.md §6.5', 'PRD CRM-07', 'DATABASE §6.2 `tasks`'],
  states: TASK_STATES,
  initial: 'open',
  terminal: ['done', 'cancelled'],
  stored: { table: 'tasks', stateColumn: 'state' },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'open',
      permission: 'crm.lead.write',
      guard: dueAhead,
      note: 'A task for someone else also needs `crm.lead.assign` at the scope that covers them, and that person must be active in the lead’s company.',
    },
    {
      from: ['open'],
      event: 'complete',
      to: 'done',
      permission: 'crm.lead.write',
      effects: [{ key: 'set_done_at', description: 'record when the task was done' }],
    },
    {
      from: ['open'],
      event: 'reschedule',
      to: 'open',
      permission: 'crm.lead.write',
      guard: dueAhead,
    },
    { from: ['open'], event: 'cancel', to: 'cancelled', permission: 'crm.lead.write' },
  ],
});
