import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { CalendarDateSchema } from '../tax/engine';
import { LeaveAdjustKindSchema, LeaveMovementKindSchema, LeaveRequestStateSchema } from './enums';
import { isHalfDayStep, LEAVE_DAYS_PER_YEAR_MAX } from './people';

// HR1 leave (docs/03-roadmap-appendix/phase5.md §5, PRD HR-02): a request moves through the
// `leave-request` machine, and a balance is the sum of its movements, never a stored figure.

/**
 * The longest stretch one request covers, first and last day included: a bound against a typing
 * slip, not a leave rule (the rules are HR-2's).
 */
export const LEAVE_REQUEST_MAX_DAYS = 366;

/** A note a person or an approver writes on a request. */
const Note = z.string().trim().min(1).max(500);

/**
 * `hr.leave.request`: leave of one type from `fromDate` to `toDate`, both included. A person asks
 * for their own; HR may ask for anyone on the staff, such as someone with no sign-in.
 */
export const RequestLeaveInput = z
  .object({
    employeeId: IdSchema,
    leaveTypeId: IdSchema,
    fromDate: CalendarDateSchema,
    toDate: CalendarDateSchema,
    note: Note.nullable().default(null),
  })
  .strict();
export type RequestLeaveInput = z.input<typeof RequestLeaveInput>;

/** `hr.leave.approve` and `hr.leave.reject`: an approver's decision, with a note if they wish. */
export const DecideLeaveInput = z
  .object({ id: IdSchema, note: Note.nullable().default(null) })
  .strict();
export type DecideLeaveInput = z.input<typeof DecideLeaveInput>;

/** `hr.leave.cancel`: the person who asked takes a waiting request back. */
export const CancelLeaveInput = z.object({ id: IdSchema }).strict();
export type CancelLeaveInput = z.input<typeof CancelLeaveInput>;

/** One leave request as the commands answer it. */
export const LeaveRequestDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    employeeId: IdSchema,
    leaveTypeId: IdSchema,
    fromDate: CalendarDateSchema,
    toDate: CalendarDateSchema,
    days: z.number(),
    note: z.string().nullable(),
    state: LeaveRequestStateSchema,
    decidedAt: z.iso.datetime().nullable(),
    decisionNote: z.string().nullable(),
  })
  .strict();
export type LeaveRequestDto = z.infer<typeof LeaveRequestDto>;

/**
 * `hr.leave.adjust`: HR grants days of a leave type to a person, or corrects their balance either
 * way, always with a reason.
 */
export const AdjustLeaveInput = z
  .object({
    employeeId: IdSchema,
    leaveTypeId: IdSchema,
    kind: LeaveAdjustKindSchema,
    days: z
      .number()
      .min(-LEAVE_DAYS_PER_YEAR_MAX)
      .max(LEAVE_DAYS_PER_YEAR_MAX)
      .refine((d) => d !== 0, { message: 'a movement changes the balance' })
      .refine(isHalfDayStep, { message: 'whole or half days' }),
    reason: z.string().trim().min(1).max(300),
  })
  .strict()
  .refine((a) => a.kind !== 'grant' || a.days > 0, {
    message: 'a grant adds days',
    path: ['days'],
  });
export type AdjustLeaveInput = z.input<typeof AdjustLeaveInput>;

/** One movement of a leave balance. */
export const LeaveMovementDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    employeeId: IdSchema,
    leaveTypeId: IdSchema,
    kind: LeaveMovementKindSchema,
    days: z.number(),
    leaveRequestId: IdSchema.nullable(),
    reason: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type LeaveMovementDto = z.infer<typeof LeaveMovementDto>;
