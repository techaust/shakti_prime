import { defineMachine, reasonGiven, type Guard } from '../define-machine';

export const SCHEDULE_SLOT_STATES = ['proposed', 'confirmed', 'done', 'cancelled'] as const;
export type ScheduleSlotMachineState = (typeof SCHEDULE_SLOT_STATES)[number];
export type ScheduleSlotEvent = 'propose' | 'confirm' | 'move' | 'cancel' | 'done';

/** What the slot commands preload for the guards. */
export interface ScheduleSlotRecord {
  state: ScheduleSlotMachineState | null;
  /** When the visit starts as saved; null before it exists. */
  startsAt: Date | null;
}

export interface ScheduleSlotParams {
  /** The start the event asks for: `propose` and `move`. */
  startsAt?: Date;
  reason?: string | null;
}

type G = Guard<ScheduleSlotRecord, ScheduleSlotParams>;

/** A start a minute in the past still counts as now: a board takes a moment to send. */
const GRACE_MS = 60_000;

const startAhead: G = {
  description: 'the visit starts now or later',
  check: (record, { now, params }) => {
    const start = params.startsAt ?? record.startsAt;
    return start !== null && start.getTime() >= now.getTime() - GRACE_MS
      ? undefined
      : { code: 'validation_failed', reason: 'slot_in_past' };
  },
};

const started: G = {
  description: 'the visit has started',
  check: (record, { now }) =>
    record.startsAt !== null && record.startsAt.getTime() <= now.getTime()
      ? undefined
      : { code: 'conflict', reason: 'slot_not_started' },
};

/**
 * A visit to a project's step on the scheduling board (docs/03-roadmap-appendix/phase4.md §7.2,
 * PRD PRJ-04). Conflicts (double booking, time away, travel) are named by
 * `findScheduleConflicts()` before every save, outside the machine: a person may save over them
 * with a reason, which the audit trail records with the conflicts.
 */
export const scheduleSlotMachine = defineMachine<
  ScheduleSlotMachineState,
  ScheduleSlotEvent,
  ScheduleSlotRecord,
  ScheduleSlotParams
>({
  name: 'schedule_slot',
  title: 'Scheduled visit',
  summary:
    "`schedule_slots.state`. One engineer's or one crew's visit to a project's step, from a start to an end. Proposed by a scheduler or the Orchestrator; booked only when a person confirms it.",
  sources: [
    'docs/03-roadmap-appendix/phase4.md §7.2',
    'PRD PRJ-04',
    'docs/03-roadmap-appendix/phase4.md §2 question 6',
  ],
  states: SCHEDULE_SLOT_STATES,
  initial: 'proposed',
  terminal: ['done', 'cancelled'],
  stored: { table: 'schedule_slots', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
  transitions: [
    {
      from: 'new',
      event: 'propose',
      to: 'proposed',
      permission: 'projects.schedule.write',
      scope: 'entity',
      guard: startAhead,
      effects: [
        {
          key: 'check_conflicts',
          description: 'name the conflicts; save over them only with a reason, audited with them',
        },
        { key: 'travel_min', description: 'record the travel from the visit before' },
      ],
      note: 'The Orchestrator may propose (`projects.schedule.write`); every later event is a person’s.',
    },
    {
      from: ['proposed'],
      event: 'confirm',
      to: 'confirmed',
      permission: 'projects.schedule.write',
      scope: 'entity',
      guard: startAhead,
      effects: [
        {
          key: 'check_conflicts',
          description: 'name the conflicts again; save over them only with a reason',
        },
      ],
      note: 'People only, never an agent (PRJ-04).',
    },
    {
      from: ['proposed'],
      event: 'move',
      to: 'proposed',
      permission: 'projects.schedule.write',
      scope: 'entity',
      guard: startAhead,
      effects: [
        {
          key: 'check_conflicts',
          description: 'name the conflicts; save over them only with a reason',
        },
      ],
      note: 'Another time, engineer or crew: dragged on the board, or moved with the keyboard. People only.',
      proposed: true,
    },
    {
      from: ['confirmed'],
      event: 'move',
      to: 'confirmed',
      permission: 'projects.schedule.write',
      scope: 'entity',
      guard: startAhead,
      effects: [
        {
          key: 'check_conflicts',
          description: 'name the conflicts; save over them only with a reason',
        },
      ],
      note: 'A confirmed visit moved by a person stays confirmed. People only.',
      proposed: true,
    },
    {
      from: ['proposed', 'confirmed'],
      event: 'cancel',
      to: 'cancelled',
      permission: 'projects.schedule.write',
      scope: 'entity',
      guard: reasonGiven(),
      note: 'People only.',
      proposed: true,
    },
    {
      from: ['confirmed'],
      event: 'done',
      to: 'done',
      permission: 'projects.write',
      guard: started,
      effects: [{ key: 'set_done', description: 'record who did the visit, when, and their note' }],
      note: 'The person on the visit (its engineer or a member of its crew) or a scheduler records it; the step itself is completed by `projects.milestone.complete`. People only.',
      proposed: true,
    },
  ],
});
