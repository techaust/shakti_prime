import {
  AdjustLeaveInput,
  CancelLeaveInput,
  DecideLeaveInput,
  DomainError,
  hasGrant,
  LEAVE_REQUEST_MAX_DAYS,
  LeaveMovementDto,
  LeaveRequestDto,
  newId,
  RequestLeaveInput,
  type LeaveRequestState,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { holidaysBetween } from '../../hr/calendar';
import { countLeaveDays, isCalendarDate, spanDays } from '../../hr/leave-days';
import {
  daysValue,
  type LeaveRequestRow,
  toLeaveMovementDto,
  toLeaveRequestDto,
} from '../../hr/rows';
import { transition } from '../../state-machines/define-machine';
import {
  leaveRequestMachine,
  type LeaveRequestEvent,
} from '../../state-machines/machines/leave-request';

/**
 * Leave (docs/03-roadmap-appendix/phase5.md §5, PRD HR-02). A person asks for their own leave, HR
 * for anyone on the staff; an approver decides in their scope (the people they manage at team
 * scope, the company, every company) and never on their own leave; an approval takes the days off
 * the balance once, and a balance is only ever its movements. No leave rule is filled in for the
 * client: a request is not held against the balance, which the approver sees.
 */

const REQUEST_AUDIT_FIELDS = ['fromDate', 'toDate', 'leaveDays', 'note', 'state'] as const;
const DECISION_AUDIT_FIELDS = ['state', 'decisionNote', 'leaveDays'] as const;

function auditedRequest(row: LeaveRequestRow) {
  return {
    employeeId: row.employeeId,
    leaveTypeId: row.leaveTypeId,
    fromDate: row.fromDate,
    toDate: row.toDate,
    leaveDays: Number(row.days),
    note: row.note,
    state: row.state,
  };
}

/** `hr.leave.request`: leave of one type over a span of days. */
export const requestLeave = defineCommand({
  name: 'hr.leave.request',
  permission: 'hr.leave.request',
  minScope: 'own',
  peopleOnly: true,
  input: RequestLeaveInput,
  output: LeaveRequestDto,
  auditFields: REQUEST_AUDIT_FIELDS,
  constraintReasons: { leave_requests_no_overlap: 'leave_overlaps' },
  async handler(ctx, input) {
    const e = schema.employees;
    const [employee] = await ctx.tx.select().from(e).where(eq(e.id, input.employeeId)).limit(1);
    if (!employee) {
      throw new DomainError('not_found', `employee ${input.employeeId} is not readable`, {
        reason: 'employee_missing',
      });
    }
    if (!ctx.entityIds.includes(employee.entityId)) {
      throw new DomainError('forbidden', 'company outside the request scope', {
        reason: 'config_company_scope',
      });
    }
    if (
      employee.userId !== ctx.principal.id &&
      !hasGrant(ctx.principal.permissions, 'hr.employee.write', 'all')
    ) {
      throw new DomainError('forbidden', 'leave for someone else is asked for by HR', {
        reason: 'leave_for_someone_else',
      });
    }
    if (!employee.active) {
      throw new DomainError('conflict', `employee ${employee.id} has left`, {
        reason: 'employee_inactive',
      });
    }
    transition(
      leaveRequestMachine,
      { state: null, employeeUserId: employee.userId, callerAsked: true },
      'request',
      { actor: { kind: 'principal', principal: ctx.principal }, now: ctx.now, params: {} },
    );
    if (!isCalendarDate(input.fromDate) || !isCalendarDate(input.toDate)) {
      throw new DomainError('validation_failed', 'not a calendar date', {
        reason: 'leave_dates_invalid',
      });
    }
    const span = spanDays(input.fromDate, input.toDate);
    if (span === 0) {
      throw new DomainError('validation_failed', 'the last day is before the first', {
        reason: 'leave_dates_backwards',
      });
    }
    if (span > LEAVE_REQUEST_MAX_DAYS) {
      throw new DomainError('validation_failed', 'the span is longer than a year', {
        reason: 'leave_span_too_long',
      });
    }
    const t = schema.leaveTypes;
    const [type] = await ctx.tx
      .select({ id: t.id })
      .from(t)
      .where(
        and(
          eq(t.id, input.leaveTypeId),
          isNull(t.archivedAt),
          or(isNull(t.entityId), eq(t.entityId, employee.entityId)),
        ),
      )
      .limit(1);
    if (!type) {
      throw new DomainError('validation_failed', `leave type ${input.leaveTypeId} is not offered`, {
        reason: 'leave_type_missing',
      });
    }
    let weeklyOffDays: readonly number[] = [];
    if (employee.shiftId !== null) {
      const s = schema.shifts;
      const [shift] = await ctx.tx
        .select({ weeklyOffDays: s.weeklyOffDays })
        .from(s)
        .where(eq(s.id, employee.shiftId))
        .limit(1);
      weeklyOffDays = shift?.weeklyOffDays ?? [];
    }
    const holidays = await holidaysBetween(ctx.tx, employee.entityId, input.fromDate, input.toDate);
    const days = countLeaveDays({
      fromDate: input.fromDate,
      toDate: input.toDate,
      weeklyOffDays,
      holidays,
    });
    if (days === 0) {
      throw new DomainError('validation_failed', 'the span holds no working day', {
        reason: 'leave_no_working_days',
      });
    }
    const [row] = await ctx.tx
      .insert(schema.leaveRequests)
      .values({
        id: newId(),
        entityId: employee.entityId,
        employeeId: employee.id,
        leaveTypeId: input.leaveTypeId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        days: daysValue(days),
        note: input.note,
        requestedBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'leave request insert returned no row');
    ctx.audit({
      aggregateType: 'leave_request',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: auditedRequest(row),
    });
    return toLeaveRequestDto(row);
  },
});

interface LockedRequest {
  row: LeaveRequestRow;
  employeeUserId: string | null;
  managerId: string | null;
}

/** The request with its employee's sign-in and manager, locked for a decision. */
async function lockRequest(ctx: CommandContext, id: string): Promise<LockedRequest> {
  const r = schema.leaveRequests;
  const [row] = await ctx.tx.select().from(r).where(eq(r.id, id)).limit(1).for('update');
  if (!row) {
    throw new DomainError('not_found', `leave request ${id} is not readable`, {
      reason: 'leave_request_missing',
    });
  }
  if (!ctx.entityIds.includes(row.entityId)) {
    throw new DomainError('forbidden', 'company outside the request scope', {
      reason: 'config_company_scope',
    });
  }
  const e = schema.employees;
  const [employee] = await ctx.tx
    .select({ userId: e.userId, managerId: e.managerId })
    .from(e)
    .where(eq(e.id, row.employeeId))
    .limit(1);
  return { row, employeeUserId: employee?.userId ?? null, managerId: employee?.managerId ?? null };
}

/**
 * An approver at team scope decides only for the people they manage: the employee's manager is
 * the caller's own record, in post.
 */
async function assertApproverScope(ctx: CommandContext, locked: LockedRequest): Promise<void> {
  if (hasGrant(ctx.principal.permissions, 'hr.leave.approve', 'entity')) return;
  const e = schema.employees;
  const [manager] =
    locked.managerId === null
      ? []
      : await ctx.tx
          .select({ id: e.id })
          .from(e)
          .where(
            and(eq(e.id, locked.managerId), eq(e.userId, ctx.principal.id), eq(e.active, true)),
          )
          .limit(1);
  if (!manager) {
    throw new DomainError('forbidden', 'the leave is outside the approver scope', {
      reason: 'leave_outside_scope',
    });
  }
}

/** Fires a decision on a locked request and writes it. */
async function decide(
  ctx: CommandContext,
  locked: LockedRequest,
  event: Exclude<LeaveRequestEvent, 'request'>,
  note: string | null,
): Promise<LeaveRequestRow> {
  const { to } = transition(
    leaveRequestMachine,
    {
      state: locked.row.state as LeaveRequestState,
      employeeUserId: locked.employeeUserId,
      callerAsked:
        locked.row.requestedBy === ctx.principal.id || locked.employeeUserId === ctx.principal.id,
    },
    event,
    { actor: { kind: 'principal', principal: ctx.principal }, now: ctx.now, params: {} },
  );
  if (event !== 'cancel') await assertApproverScope(ctx, locked);
  const r = schema.leaveRequests;
  const [row] = await ctx.tx
    .update(r)
    .set({
      state: to,
      decidedBy: ctx.principal.id,
      decidedAt: ctx.now,
      decisionNote: note,
      updatedBy: ctx.principal.id,
    })
    .where(eq(r.id, locked.row.id))
    .returning();
  if (!row) throw new DomainError('internal', 'leave request update returned no row');
  ctx.audit({
    aggregateType: 'leave_request',
    aggregateId: row.id,
    entityId: row.entityId,
    before: { state: locked.row.state, decisionNote: null, leaveDays: Number(locked.row.days) },
    after: { state: row.state, decisionNote: row.decisionNote, leaveDays: Number(row.days) },
  });
  return row;
}

/**
 * `hr.leave.approve`: approves a waiting request and takes its days off the balance, once. The
 * `hr.leave.approved` event is where J5's unavailability takes the approved days.
 */
export const approveLeave = defineCommand({
  name: 'hr.leave.approve',
  permission: 'hr.leave.approve',
  minScope: 'team',
  peopleOnly: true,
  input: DecideLeaveInput,
  output: LeaveRequestDto,
  auditFields: [...DECISION_AUDIT_FIELDS, 'movementKind'],
  constraintReasons: { leave_balances_use_unique: 'leave_request_decided' },
  async handler(ctx, input) {
    const locked = await lockRequest(ctx, input.id);
    const row = await decide(ctx, locked, 'approve', input.note);
    const [movement] = await ctx.tx
      .insert(schema.leaveBalances)
      .values({
        id: newId(),
        entityId: row.entityId,
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        kind: 'use',
        days: daysValue(-Number(row.days)),
        leaveRequestId: row.id,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!movement) throw new DomainError('internal', 'leave movement insert returned no row');
    ctx.audit({
      aggregateType: 'leave_balance',
      aggregateId: movement.id,
      entityId: movement.entityId,
      before: null,
      after: {
        employeeId: movement.employeeId,
        leaveTypeId: movement.leaveTypeId,
        movementKind: movement.kind,
        leaveDays: Number(movement.days),
      },
    });
    ctx.emit({
      type: 'hr.leave.approved',
      entityId: row.entityId,
      aggregateType: 'leave_request',
      aggregateId: row.id,
      payload: {
        leaveRequestId: row.id,
        employeeId: row.employeeId,
        fromDate: row.fromDate,
        toDate: row.toDate,
      },
    });
    return toLeaveRequestDto(row);
  },
});

/** `hr.leave.reject`: turns down a waiting request; the balance is untouched. */
export const rejectLeave = defineCommand({
  name: 'hr.leave.reject',
  permission: 'hr.leave.approve',
  minScope: 'team',
  peopleOnly: true,
  input: DecideLeaveInput,
  output: LeaveRequestDto,
  auditFields: DECISION_AUDIT_FIELDS,
  async handler(ctx, input) {
    const locked = await lockRequest(ctx, input.id);
    return toLeaveRequestDto(await decide(ctx, locked, 'reject', input.note));
  },
});

/** `hr.leave.cancel`: the person who asked takes a waiting request back. */
export const cancelLeave = defineCommand({
  name: 'hr.leave.cancel',
  permission: 'hr.leave.request',
  minScope: 'own',
  peopleOnly: true,
  input: CancelLeaveInput,
  output: LeaveRequestDto,
  auditFields: DECISION_AUDIT_FIELDS,
  async handler(ctx, input) {
    const locked = await lockRequest(ctx, input.id);
    return toLeaveRequestDto(await decide(ctx, locked, 'cancel', null));
  },
});

/** `hr.leave.adjust`: HR grants days of a leave type, or corrects a balance, with a reason. */
export const adjustLeave = defineCommand({
  name: 'hr.leave.adjust',
  permission: 'hr.employee.write',
  minScope: 'all',
  peopleOnly: true,
  input: AdjustLeaveInput,
  output: LeaveMovementDto,
  auditFields: ['movementKind', 'leaveDays', 'adjustReason'],
  async handler(ctx, input) {
    const e = schema.employees;
    const [employee] = await ctx.tx
      .select({ id: e.id, entityId: e.entityId })
      .from(e)
      .where(eq(e.id, input.employeeId))
      .limit(1);
    if (!employee) {
      throw new DomainError('not_found', `employee ${input.employeeId} is not readable`, {
        reason: 'employee_missing',
      });
    }
    if (!ctx.entityIds.includes(employee.entityId)) {
      throw new DomainError('forbidden', 'company outside the request scope', {
        reason: 'config_company_scope',
      });
    }
    const t = schema.leaveTypes;
    const [type] = await ctx.tx
      .select({ id: t.id })
      .from(t)
      .where(
        and(eq(t.id, input.leaveTypeId), or(isNull(t.entityId), eq(t.entityId, employee.entityId))),
      )
      .limit(1);
    if (!type) {
      throw new DomainError('validation_failed', `leave type ${input.leaveTypeId} is not offered`, {
        reason: 'leave_type_missing',
      });
    }
    const [row] = await ctx.tx
      .insert(schema.leaveBalances)
      .values({
        id: newId(),
        entityId: employee.entityId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        kind: input.kind,
        days: daysValue(input.days),
        reason: input.reason,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'leave movement insert returned no row');
    ctx.audit({
      aggregateType: 'leave_balance',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: {
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        movementKind: row.kind,
        leaveDays: Number(row.days),
        adjustReason: row.reason,
      },
    });
    return toLeaveMovementDto(row);
  },
});
