import { LEAVE_REQUEST_STATES, type LeaveRequestState } from '@shakti/contracts';
import { defineMachine, type Guard } from '../define-machine';

export type LeaveRequestEvent = 'request' | 'approve' | 'reject' | 'cancel';

/** What the leave commands preload for the guards. */
export interface LeaveRequestRecord {
  state: LeaveRequestState | null;
  /** The sign-in of the person whose leave it is; null for staff with no sign-in. */
  employeeUserId: string | null;
  /** The caller asked for the leave, or it is their own: the command works it out. */
  callerAsked: boolean;
}

type G = Guard<LeaveRequestRecord, Record<string, never>>;

const notOwnLeave: G = {
  description: 'the approver is not the person whose leave it is',
  check: (record, { actor }) =>
    actor.kind === 'principal' &&
    record.employeeUserId !== null &&
    record.employeeUserId === actor.principal.id
      ? { code: 'forbidden', reason: 'leave_own_decision' }
      : undefined,
};

const askedByCaller: G = {
  description: 'the caller asked for the leave, or it is their own',
  check: (record) =>
    record.callerAsked ? undefined : { code: 'forbidden', reason: 'leave_cancel_not_yours' },
};

/** A request for leave (docs/03-roadmap-appendix/phase5.md §5, PRD HR-02). */
export const leaveRequestMachine = defineMachine<
  LeaveRequestState,
  LeaveRequestEvent,
  LeaveRequestRecord,
  Record<string, never>
>({
  name: 'leave_request',
  title: 'Leave request',
  summary:
    '`leave_requests.state`. Leave of one type over a span of days for one person on the staff. A person asks for their own; HR may ask for anyone. An approver decides it in their scope (the people they manage at team scope, the company, or every company), never their own; the person who asked takes it back while it waits.',
  sources: ['docs/03-roadmap-appendix/phase5.md §5', 'PRD HR-02', 'DATABASE §6.8 `leave_requests`'],
  states: LEAVE_REQUEST_STATES,
  initial: 'requested',
  terminal: ['approved', 'rejected', 'cancelled'],
  stored: { table: 'leave_requests', stateColumn: 'state', changedAtColumn: 'decided_at' },
  transitions: [
    {
      from: 'new',
      event: 'request',
      to: 'requested',
      permission: 'hr.leave.request',
      note: 'For someone else’s leave, `hr.employee.write` for every company. The days are the working days of the span by the person’s shift and the holidays; a span with none, or one overlapping a waiting or approved request, is refused.',
    },
    {
      from: ['requested'],
      event: 'approve',
      to: 'approved',
      permission: 'hr.leave.approve',
      scope: 'team',
      guard: notOwnLeave,
      effects: [
        { key: 'use_balance', description: 'take the days off the balance, once' },
        { key: 'record_decision', description: 'record who approved it and when' },
      ],
      emits: 'hr.leave.approved',
      note: 'At team scope, only for the people whose manager is the approver.',
    },
    {
      from: ['requested'],
      event: 'reject',
      to: 'rejected',
      permission: 'hr.leave.approve',
      scope: 'team',
      guard: notOwnLeave,
      effects: [{ key: 'record_decision', description: 'record who rejected it and when' }],
      note: 'At team scope, only for the people whose manager is the approver.',
    },
    {
      from: ['requested'],
      event: 'cancel',
      to: 'cancelled',
      permission: 'hr.leave.request',
      guard: askedByCaller,
      effects: [{ key: 'record_decision', description: 'record when it was taken back' }],
    },
  ],
});
