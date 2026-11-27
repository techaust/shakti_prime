import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { actorsRequired, archivable, timestamps } from './columns';
import { entities } from './entities';
import { users } from './identity';
import { principals } from './principals';

// HR1: the employee directory, shifts, holidays and leave (docs/03-roadmap-appendix/phase5.md §5,
// DATABASE §6.8). Read by the hr.* scopes, a person reading their own employee row, balance and
// requests; the policies are in the custom migration beside this table's.

/** A number of days in halves. */
const days = (name: string) => numeric(name, { precision: 5, scale: 1 });

/**
 * A working pattern: the IST wall-clock start and end, the lunch break and the grace before a
 * person counts as late, and the ISO days of the week off (1 Monday to 7 Sunday). Of one company,
 * or of the whole group with no company.
 */
export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    name: text('name').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    lunchMin: smallint('lunch_min').notNull(),
    graceMin: smallint('grace_min').notNull(),
    weeklyOffDays: smallint('weekly_off_days')
      .array()
      .notNull()
      .default(sql`'{}'`),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    uniqueIndex('shifts_entity_name_unique')
      .on(sql`coalesce(${t.entityId}, 0)`, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check('shifts_name_check', sql`char_length(${t.name}) between 1 and 120`),
    check('shifts_times_check', sql`${t.startTime} <> ${t.endTime}`),
    check('shifts_lunch_check', sql`${t.lunchMin} between 0 and 240`),
    check('shifts_grace_check', sql`${t.graceMin} between 0 and 120`),
    check(
      'shifts_weekly_off_check',
      sql`${t.weeklyOffDays} <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(${t.weeklyOffDays}) <= 6`,
    ),
  ],
);

/** A holiday of one company, or of the whole group, on a day. */
export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    onDate: date('on_date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    uniqueIndex('holidays_entity_date_unique').on(sql`coalesce(${t.entityId}, 0)`, t.onDate),
    index('holidays_date_idx').on(t.onDate),
    check('holidays_name_check', sql`char_length(${t.name}) between 1 and 120`),
  ],
);

/** A kind of leave: the days a year, whether unused days carry over and whether it is paid. */
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    name: text('name').notNull(),
    daysPerYear: days('days_per_year').notNull(),
    carriesForward: boolean('carries_forward').notNull(),
    isPaid: boolean('is_paid').notNull(),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    uniqueIndex('leave_types_entity_name_unique')
      .on(sql`coalesce(${t.entityId}, 0)`, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check('leave_types_name_check', sql`char_length(${t.name}) between 1 and 120`),
    check(
      'leave_types_days_check',
      sql`${t.daysPerYear} between 0 and 366 and ${t.daysPerYear} * 2 = trunc(${t.daysPerYear} * 2)`,
    ),
  ],
);

/**
 * A person on the staff of one company: with their sign-in (`user_id`) or without one, at most
 * one record per person and company. `active` is false from the day they left.
 */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    userId: uuid('user_id').references(() => users.id),
    name: text('name').notNull(),
    phone: text('phone'),
    managerId: uuid('manager_id'),
    shiftId: uuid('shift_id').references(() => shifts.id),
    office: text('office'),
    joinedOn: date('joined_on', { mode: 'string' }).notNull(),
    active: boolean('active').notNull().default(true),
    leftOn: date('left_on', { mode: 'string' }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('employees_id_entity_unique').on(t.id, t.entityId),
    uniqueIndex('employees_user_entity_unique')
      .on(t.userId, t.entityId)
      .where(sql`${t.userId} is not null`),
    // A manager is on the staff of the same company.
    foreignKey({
      name: 'employees_manager_fk',
      columns: [t.managerId, t.entityId],
      foreignColumns: [t.id, t.entityId],
    }),
    index('employees_entity_name_idx').on(t.entityId, sql`lower(${t.name})`, t.id),
    index('employees_manager_idx').on(t.managerId),
    index('employees_shift_idx').on(t.shiftId),
    check('employees_name_check', sql`char_length(${t.name}) between 1 and 120`),
    check('employees_phone_check', sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check(
      'employees_office_check',
      sql`${t.office} is null or char_length(${t.office}) between 1 and 80`,
    ),
    check('employees_manager_check', sql`${t.managerId} is null or ${t.managerId} <> ${t.id}`),
    check('employees_active_check', sql`${t.active} = (${t.leftOn} is null)`),
    check('employees_left_check', sql`${t.leftOn} is null or ${t.leftOn} >= ${t.joinedOn}`),
  ],
);

/**
 * A request for leave of one type over a span of days, both ends included; `days` is the number
 * of working days in it when it was asked for. Its state follows the `leave-request` machine.
 */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    days: days('days').notNull(),
    note: text('note'),
    state: text('state').notNull().default('requested'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references((): AnyPgColumn => principals.id),
    decidedBy: uuid('decided_by').references((): AnyPgColumn => principals.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...timestamps,
    updatedBy: uuid('updated_by').references((): AnyPgColumn => principals.id),
  },
  (t) => [
    unique('leave_requests_id_entity_unique').on(t.id, t.entityId),
    foreignKey({
      name: 'leave_requests_employee_fk',
      columns: [t.employeeId, t.entityId],
      foreignColumns: [employees.id, employees.entityId],
    }),
    index('leave_requests_employee_idx').on(t.employeeId, t.fromDate.desc()),
    index('leave_requests_waiting_idx')
      .on(t.entityId, t.createdAt)
      .where(sql`${t.state} = 'requested'`),
    index('leave_requests_type_idx').on(t.leaveTypeId),
    check(
      'leave_requests_state_check',
      sql`${t.state} in ('requested', 'approved', 'rejected', 'cancelled')`,
    ),
    check('leave_requests_span_check', sql`${t.toDate} >= ${t.fromDate}`),
    check(
      'leave_requests_days_check',
      sql`${t.days} > 0 and ${t.days} <= 366 and ${t.days} * 2 = trunc(${t.days} * 2)`,
    ),
    check(
      'leave_requests_decided_check',
      sql`(${t.state} = 'requested') = (${t.decidedBy} is null and ${t.decidedAt} is null)`,
    ),
    check('leave_requests_note_check', sql`${t.note} is null or char_length(${t.note}) <= 500`),
    check(
      'leave_requests_decision_note_check',
      sql`${t.decisionNote} is null or char_length(${t.decisionNote}) <= 500`,
    ),
  ],
);

/**
 * The movements of a person's leave balance of one type, append-only: a balance is their sum.
 * `use` takes off an approved request's days, once per request; `grant` and `adjust` are HR's,
 * each with its reason.
 */
export const leaveBalances = pgTable(
  'leave_balances',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    kind: text('kind').notNull(),
    days: days('days').notNull(),
    leaveRequestId: uuid('leave_request_id'),
    reason: text('reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references((): AnyPgColumn => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'leave_balances_employee_fk',
      columns: [t.employeeId, t.entityId],
      foreignColumns: [employees.id, employees.entityId],
    }),
    foreignKey({
      name: 'leave_balances_request_fk',
      columns: [t.leaveRequestId, t.entityId],
      foreignColumns: [leaveRequests.id, leaveRequests.entityId],
    }),
    // An approval takes the days off once.
    uniqueIndex('leave_balances_use_unique')
      .on(t.leaveRequestId)
      .where(sql`${t.kind} = 'use'`),
    index('leave_balances_employee_idx').on(t.employeeId, t.leaveTypeId, t.createdAt),
    index('leave_balances_type_idx').on(t.leaveTypeId),
    check('leave_balances_kind_check', sql`${t.kind} in ('grant', 'use', 'adjust')`),
    check(
      'leave_balances_days_check',
      sql`${t.days} <> 0 and abs(${t.days}) <= 366 and ${t.days} * 2 = trunc(${t.days} * 2)
          and (${t.kind} <> 'grant' or ${t.days} > 0) and (${t.kind} <> 'use' or ${t.days} < 0)`,
    ),
    check(
      'leave_balances_source_check',
      sql`(${t.kind} = 'use') = (${t.leaveRequestId} is not null)
          and (${t.kind} = 'use' or ${t.reason} is not null)`,
    ),
    check(
      'leave_balances_reason_check',
      sql`${t.reason} is null or char_length(${t.reason}) between 1 and 300`,
    ),
  ],
);
