import { z } from 'zod';

/**
 * The states of a leave request (the `leave-request` machine, docs/03-roadmap-appendix/phase5.md
 * §5): asked for, then approved or rejected by an approver, or cancelled by the person who asked
 * while it waits.
 */
export const LEAVE_REQUEST_STATES = ['requested', 'approved', 'rejected', 'cancelled'] as const;
export const LeaveRequestStateSchema = z.enum(LEAVE_REQUEST_STATES);
export type LeaveRequestState = z.infer<typeof LeaveRequestStateSchema>;

/**
 * One movement of a leave balance, which is never stored as a figure: `grant` adds days, `use`
 * takes off an approved request's days (once per request), `adjust` corrects either way.
 */
export const LEAVE_MOVEMENT_KINDS = ['grant', 'use', 'adjust'] as const;
export const LeaveMovementKindSchema = z.enum(LEAVE_MOVEMENT_KINDS);
export type LeaveMovementKind = z.infer<typeof LeaveMovementKindSchema>;

/** The movements HR records by hand (`hr.leave.adjust`); `use` comes only from an approval. */
export const LeaveAdjustKindSchema = z.enum(['grant', 'adjust']);
export type LeaveAdjustKind = z.infer<typeof LeaveAdjustKindSchema>;

/** A day of the week as ISO numbers it: 1 is Monday, 7 is Sunday. */
export const IsoWeekdaySchema = z.number().int().min(1).max(7);
export type IsoWeekday = z.infer<typeof IsoWeekdaySchema>;
