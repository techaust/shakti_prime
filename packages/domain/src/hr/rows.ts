import type {
  EmployeeDto,
  LeaveMovementDto,
  LeaveMovementKind,
  LeaveRequestDto,
  LeaveRequestState,
  LeaveTypeDto,
  ShiftDto,
} from '@shakti/contracts';
import type { schema } from '@shakti/db';

// HR1: the rows of the HR tables as the commands and queries answer them.

export type EmployeeRow = typeof schema.employees.$inferSelect;
export type ShiftRow = typeof schema.shifts.$inferSelect;
export type LeaveTypeRow = typeof schema.leaveTypes.$inferSelect;
export type LeaveRequestRow = typeof schema.leaveRequests.$inferSelect;
export type LeaveMovementRow = typeof schema.leaveBalances.$inferSelect;

/** `HH:MM` of a `time` column, which the database answers as `HH:MM:SS`. */
export function clockTime(value: string): string {
  return value.slice(0, 5);
}

export function toEmployeeDto(row: EmployeeRow): EmployeeDto {
  return {
    id: row.id,
    entityId: row.entityId,
    userId: row.userId,
    name: row.name,
    phone: row.phone,
    managerId: row.managerId,
    shiftId: row.shiftId,
    office: row.office,
    joinedOn: row.joinedOn,
    active: row.active,
    leftOn: row.leftOn,
  };
}

export function toShiftDto(row: ShiftRow): ShiftDto {
  return {
    id: row.id,
    entityId: row.entityId,
    name: row.name,
    startTime: clockTime(row.startTime),
    endTime: clockTime(row.endTime),
    lunchMinutes: row.lunchMin,
    graceMinutes: row.graceMin,
    weeklyOffDays: [...row.weeklyOffDays].sort((a, b) => a - b),
    archived: row.archivedAt !== null,
  };
}

export function toLeaveTypeDto(row: LeaveTypeRow): LeaveTypeDto {
  return {
    id: row.id,
    entityId: row.entityId,
    name: row.name,
    daysPerYear: Number(row.daysPerYear),
    carriesForward: row.carriesForward,
    paid: row.isPaid,
    archived: row.archivedAt !== null,
  };
}

export function toLeaveRequestDto(row: LeaveRequestRow): LeaveRequestDto {
  return {
    id: row.id,
    entityId: row.entityId,
    employeeId: row.employeeId,
    leaveTypeId: row.leaveTypeId,
    fromDate: row.fromDate,
    toDate: row.toDate,
    days: Number(row.days),
    note: row.note,
    state: row.state as LeaveRequestState,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
  };
}

export function toLeaveMovementDto(row: LeaveMovementRow): LeaveMovementDto {
  return {
    id: row.id,
    entityId: row.entityId,
    employeeId: row.employeeId,
    leaveTypeId: row.leaveTypeId,
    kind: row.kind as LeaveMovementKind,
    days: Number(row.days),
    leaveRequestId: row.leaveRequestId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Days as the database stores them: halves, one decimal. */
export function daysValue(days: number): string {
  return days.toFixed(1);
}
