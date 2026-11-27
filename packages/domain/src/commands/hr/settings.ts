import {
  DomainError,
  HolidayDto,
  LeaveTypeDto,
  newId,
  SetHolidayInput,
  SetLeaveTypeInput,
  SetShiftInput,
  ShiftDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import {
  daysValue,
  type LeaveTypeRow,
  type ShiftRow,
  toLeaveTypeDto,
  toShiftDto,
} from '../../hr/rows';
import { assertConfigScope } from '../crm/config-scope';

/**
 * HR's settings (docs/03-roadmap-appendix/phase5.md §5, PRD HR-01 and HR-02): shifts, holidays and
 * leave types, of one company or of the whole group. A group row is changed only in a request
 * acting for every company, as CRM's shared set-up is. Nothing is filled in for the client: a new
 * shift starts from HR-1's working day on screen, and the leave types and holidays stay empty
 * until HR-2 answers. People only.
 */

const SHIFT_AUDIT_FIELDS = [
  'shiftName',
  'startTime',
  'endTime',
  'lunchMinutes',
  'graceMinutes',
  'weeklyOffDays',
  'isActive',
] as const;

function auditedShift(row: ShiftRow) {
  const dto = toShiftDto(row);
  return {
    shiftName: dto.name,
    startTime: dto.startTime,
    endTime: dto.endTime,
    lunchMinutes: dto.lunchMinutes,
    graceMinutes: dto.graceMinutes,
    weeklyOffDays: dto.weeklyOffDays.map(String),
    isActive: !dto.archived,
  };
}

/** `hr.shift.set`: a new shift, or the whole of one, archived or back in use. */
export const setShift = defineCommand({
  name: 'hr.shift.set',
  permission: 'hr.employee.write',
  minScope: 'all',
  peopleOnly: true,
  input: SetShiftInput,
  output: ShiftDto,
  auditFields: SHIFT_AUDIT_FIELDS,
  constraintReasons: { shifts_entity_name_unique: 'shift_name_taken' },
  async handler(ctx, input) {
    await assertConfigScope(ctx, input.entityId);
    const values = {
      name: input.name,
      startTime: input.startTime,
      endTime: input.endTime,
      lunchMin: input.lunchMinutes,
      graceMin: input.graceMinutes,
      weeklyOffDays: [...input.weeklyOffDays].sort((a, b) => a - b),
      archivedAt: input.archived ? ctx.now : null,
    };
    let before: ShiftRow | null = null;
    let row: ShiftRow | undefined;
    if (input.id === undefined) {
      [row] = await ctx.tx
        .insert(schema.shifts)
        .values({ id: newId(), entityId: input.entityId, ...values, createdBy: ctx.principal.id })
        .returning();
    } else {
      [before = null] = await ctx.tx
        .select()
        .from(schema.shifts)
        .where(eq(schema.shifts.id, input.id))
        .limit(1)
        .for('update');
      if (before === null) {
        throw new DomainError('not_found', `shift ${input.id} is not readable`, {
          reason: 'shift_missing',
        });
      }
      if (before.entityId !== input.entityId) {
        throw new DomainError('validation_failed', 'a shift keeps its company', {
          reason: 'hr_setting_company_fixed',
        });
      }
      [row] = await ctx.tx
        .update(schema.shifts)
        .set({
          ...values,
          // An archived shift keeps the time it was archived.
          archivedAt: input.archived ? (before.archivedAt ?? ctx.now) : null,
          updatedBy: ctx.principal.id,
        })
        .where(eq(schema.shifts.id, input.id))
        .returning();
    }
    if (!row) throw new DomainError('internal', 'shift write returned no row');
    ctx.audit({
      aggregateType: 'shift',
      aggregateId: row.id,
      entityId: row.entityId,
      before: before === null ? null : auditedShift(before),
      after: auditedShift(row),
    });
    return toShiftDto(row);
  },
});

/** `hr.holiday.set`: names the holiday of a company (or the group) on a day, or takes it off. */
export const setHoliday = defineCommand({
  name: 'hr.holiday.set',
  permission: 'hr.employee.write',
  minScope: 'all',
  peopleOnly: true,
  input: SetHolidayInput,
  output: HolidayDto,
  auditFields: ['holidayDate', 'holidayName'],
  constraintReasons: { holidays_entity_date_unique: 'holiday_changed_meanwhile' },
  async handler(ctx, input) {
    await assertConfigScope(ctx, input.entityId);
    const h = schema.holidays;
    const [before] = await ctx.tx
      .select()
      .from(h)
      .where(
        and(
          input.entityId === null ? isNull(h.entityId) : eq(h.entityId, input.entityId),
          eq(h.onDate, input.date),
        ),
      )
      .limit(1)
      .for('update');
    const auditedBefore =
      before === undefined ? null : { holidayDate: before.onDate, holidayName: before.name };
    if (input.name === null) {
      if (before === undefined) {
        return { id: null, entityId: input.entityId, date: input.date, name: null };
      }
      await ctx.tx.delete(h).where(eq(h.id, before.id));
      ctx.audit({
        aggregateType: 'holiday',
        aggregateId: before.id,
        entityId: before.entityId,
        before: auditedBefore,
        after: null,
      });
      return { id: null, entityId: input.entityId, date: input.date, name: null };
    }
    const [row] =
      before === undefined
        ? await ctx.tx
            .insert(h)
            .values({
              id: newId(),
              entityId: input.entityId,
              onDate: input.date,
              name: input.name,
              createdBy: ctx.principal.id,
            })
            .returning()
        : await ctx.tx
            .update(h)
            .set({ name: input.name, updatedBy: ctx.principal.id })
            .where(eq(h.id, before.id))
            .returning();
    if (!row) throw new DomainError('internal', 'holiday write returned no row');
    ctx.audit({
      aggregateType: 'holiday',
      aggregateId: row.id,
      entityId: row.entityId,
      before: auditedBefore,
      after: { holidayDate: row.onDate, holidayName: row.name },
    });
    return { id: row.id, entityId: row.entityId, date: row.onDate, name: row.name };
  },
});

const LEAVE_TYPE_AUDIT_FIELDS = [
  'leaveTypeName',
  'daysPerYear',
  'carriesForward',
  'paid',
  'isActive',
] as const;

function auditedLeaveType(row: LeaveTypeRow) {
  return {
    leaveTypeName: row.name,
    daysPerYear: Number(row.daysPerYear),
    carriesForward: row.carriesForward,
    paid: row.isPaid,
    isActive: row.archivedAt === null,
  };
}

/** `hr.leave_type.set`: a new leave type, or the whole of one, archived or back in use. */
export const setLeaveType = defineCommand({
  name: 'hr.leave_type.set',
  permission: 'hr.employee.write',
  minScope: 'all',
  peopleOnly: true,
  input: SetLeaveTypeInput,
  output: LeaveTypeDto,
  auditFields: LEAVE_TYPE_AUDIT_FIELDS,
  constraintReasons: { leave_types_entity_name_unique: 'leave_type_name_taken' },
  async handler(ctx, input) {
    await assertConfigScope(ctx, input.entityId);
    const values = {
      name: input.name,
      daysPerYear: daysValue(input.daysPerYear),
      carriesForward: input.carriesForward,
      isPaid: input.paid,
    };
    const t = schema.leaveTypes;
    let before: LeaveTypeRow | null = null;
    let row: LeaveTypeRow | undefined;
    if (input.id === undefined) {
      [row] = await ctx.tx
        .insert(t)
        .values({
          id: newId(),
          entityId: input.entityId,
          ...values,
          archivedAt: input.archived ? ctx.now : null,
          createdBy: ctx.principal.id,
        })
        .returning();
    } else {
      [before = null] = await ctx.tx
        .select()
        .from(t)
        .where(eq(t.id, input.id))
        .limit(1)
        .for('update');
      if (before === null) {
        throw new DomainError('not_found', `leave type ${input.id} is not readable`, {
          reason: 'leave_type_missing',
        });
      }
      if (before.entityId !== input.entityId) {
        throw new DomainError('validation_failed', 'a leave type keeps its company', {
          reason: 'hr_setting_company_fixed',
        });
      }
      [row] = await ctx.tx
        .update(t)
        .set({
          ...values,
          archivedAt: input.archived ? (before.archivedAt ?? ctx.now) : null,
          updatedBy: ctx.principal.id,
        })
        .where(eq(t.id, input.id))
        .returning();
    }
    if (!row) throw new DomainError('internal', 'leave type write returned no row');
    ctx.audit({
      aggregateType: 'leave_type',
      aggregateId: row.id,
      entityId: row.entityId,
      before: before === null ? null : auditedLeaveType(before),
      after: auditedLeaveType(row),
    });
    return toLeaveTypeDto(row);
  },
});
