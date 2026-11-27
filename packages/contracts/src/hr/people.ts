import { z } from 'zod';
import { E164Schema, PhoneInputSchema } from '../crm/phone';
import { EntityIdSchema, IdSchema } from '../ids';
import { CalendarDateSchema } from '../tax/engine';
import { IsoWeekdaySchema } from './enums';

// HR1: the employee directory, shifts, holidays and leave types (docs/03-roadmap-appendix/phase5.md
// §5, PRD HR-01 and HR-02). A shift, a holiday or a leave type belongs to one company or, with no
// company, to the whole group; an employee always to one company.

/** A person's or a shift's name as typed. */
const Name = z.string().trim().min(1).max(120);

/** A time of day in IST, `HH:MM` on the 24-hour clock. */
export const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export type ClockTime = z.infer<typeof ClockTimeSchema>;

/** A number of days in halves: 1, 1.5, 2. */
export function isHalfDayStep(value: number): boolean {
  return Number.isInteger(value * 2);
}

/** Where a person works, as HR names it (an office or a hub). */
const Office = z.string().trim().min(1).max(80);

/** `hr.employee.create`: a person on the staff of one company, with or without a sign-in. */
export const CreateEmployeeInput = z
  .object({
    entityId: EntityIdSchema,
    /** The person's sign-in, for staff who use the BOS; null for staff who do not. */
    userId: IdSchema.nullable().default(null),
    name: Name,
    phone: PhoneInputSchema.nullable().default(null),
    managerId: IdSchema.nullable().default(null),
    shiftId: IdSchema.nullable().default(null),
    office: Office.nullable().default(null),
    joinedOn: CalendarDateSchema,
  })
  .strict();
export type CreateEmployeeInput = z.input<typeof CreateEmployeeInput>;

/** `hr.employee.update`: every field HR keeps, as the form sends it. The company never changes. */
export const UpdateEmployeeInput = z
  .object({
    id: IdSchema,
    userId: IdSchema.nullable(),
    name: Name,
    phone: PhoneInputSchema.nullable(),
    managerId: IdSchema.nullable(),
    shiftId: IdSchema.nullable(),
    office: Office.nullable(),
    joinedOn: CalendarDateSchema,
  })
  .strict();
export type UpdateEmployeeInput = z.input<typeof UpdateEmployeeInput>;

/** `hr.employee.deactivate`: the person left on that day; their record and history stay. */
export const DeactivateEmployeeInput = z
  .object({ id: IdSchema, leftOn: CalendarDateSchema })
  .strict();
export type DeactivateEmployeeInput = z.input<typeof DeactivateEmployeeInput>;

/** One employee as the commands answer it. */
export const EmployeeDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    userId: IdSchema.nullable(),
    name: z.string(),
    phone: E164Schema.nullable(),
    managerId: IdSchema.nullable(),
    shiftId: IdSchema.nullable(),
    office: z.string().nullable(),
    joinedOn: CalendarDateSchema,
    active: z.boolean(),
    leftOn: CalendarDateSchema.nullable(),
  })
  .strict();
export type EmployeeDto = z.infer<typeof EmployeeDto>;

/** The longest lunch break and grace a shift takes, in minutes. */
export const SHIFT_LUNCH_MAX_MIN = 240;
export const SHIFT_GRACE_MAX_MIN = 120;

/**
 * `hr.shift.set`: a new shift (no `id`) or the whole of an existing one. A shift's company is
 * fixed when it is made; `archived` takes it out of the lists, and a person on it keeps it until
 * HR moves them.
 */
export const SetShiftInput = z
  .object({
    id: IdSchema.optional(),
    entityId: EntityIdSchema.nullable(),
    name: Name,
    startTime: ClockTimeSchema,
    endTime: ClockTimeSchema,
    lunchMinutes: z.number().int().min(0).max(SHIFT_LUNCH_MAX_MIN),
    graceMinutes: z.number().int().min(0).max(SHIFT_GRACE_MAX_MIN),
    /** The days off each week; at least one working day is left. */
    weeklyOffDays: z
      .array(IsoWeekdaySchema)
      .max(6)
      .refine((days) => new Set(days).size === days.length, { message: 'a day is named twice' }),
    archived: z.boolean().default(false),
  })
  .strict()
  .refine((s) => s.startTime !== s.endTime, {
    message: 'a shift starts and ends at different times',
    path: ['endTime'],
  });
export type SetShiftInput = z.input<typeof SetShiftInput>;

export const ShiftDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema.nullable(),
    name: z.string(),
    startTime: ClockTimeSchema,
    endTime: ClockTimeSchema,
    lunchMinutes: z.number().int(),
    graceMinutes: z.number().int(),
    weeklyOffDays: z.array(IsoWeekdaySchema),
    archived: z.boolean(),
  })
  .strict();
export type ShiftDto = z.infer<typeof ShiftDto>;

/**
 * `hr.holiday.set`: the holiday of a company (or of the group) on a day, named; a null name takes
 * the day off the list.
 */
export const SetHolidayInput = z
  .object({
    entityId: EntityIdSchema.nullable(),
    date: CalendarDateSchema,
    name: Name.nullable(),
  })
  .strict();
export type SetHolidayInput = z.input<typeof SetHolidayInput>;

/** What `hr.holiday.set` left: the holiday, or the day with none (`id` and `name` null). */
export const HolidayDto = z
  .object({
    id: IdSchema.nullable(),
    entityId: EntityIdSchema.nullable(),
    date: CalendarDateSchema,
    name: z.string().nullable(),
  })
  .strict();
export type HolidayDto = z.infer<typeof HolidayDto>;

/** The most days of one leave type a year. */
export const LEAVE_DAYS_PER_YEAR_MAX = 366;

/**
 * `hr.leave_type.set`: a new leave type (no `id`) or the whole of an existing one; its company is
 * fixed when it is made. The figures are HR's (HR-2); nothing is filled in.
 */
export const SetLeaveTypeInput = z
  .object({
    id: IdSchema.optional(),
    entityId: EntityIdSchema.nullable(),
    name: Name,
    daysPerYear: z
      .number()
      .min(0)
      .max(LEAVE_DAYS_PER_YEAR_MAX)
      .refine(isHalfDayStep, { message: 'whole or half days' }),
    carriesForward: z.boolean(),
    paid: z.boolean(),
    archived: z.boolean().default(false),
  })
  .strict();
export type SetLeaveTypeInput = z.input<typeof SetLeaveTypeInput>;

export const LeaveTypeDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema.nullable(),
    name: z.string(),
    daysPerYear: z.number(),
    carriesForward: z.boolean(),
    paid: z.boolean(),
    archived: z.boolean(),
  })
  .strict();
export type LeaveTypeDto = z.infer<typeof LeaveTypeDto>;
