'use server';

import {
  AdjustLeaveInput,
  CancelLeaveInput,
  CreateEmployeeInput,
  DeactivateEmployeeInput,
  DecideLeaveInput,
  GetEmployeeInput,
  HrChoicesInput,
  ListEmployeesInput,
  ListHolidaysInput,
  ListLeaveTypesInput,
  ListShiftsInput,
  RequestLeaveInput,
  SetHolidayInput,
  SetLeaveTypeInput,
  SetShiftInput,
  UpdateEmployeeInput,
  type EmployeeDto,
  type EmployeePageDto,
  type EmployeeSheetDto,
  type HolidayDto,
  type HolidayListDto,
  type HrChoicesDto,
  type LeaveMovementDto,
  type LeaveRequestDto,
  type LeaveScreenDto,
  type LeaveTypeDto,
  type LeaveTypeListDto,
  type ShiftDto,
  type ShiftListDto,
} from '@shakti/contracts';
import {
  adjustLeave as adjustLeaveCommand,
  approveLeave as approveLeaveCommand,
  cancelLeave as cancelLeaveCommand,
  createEmployee as createEmployeeCommand,
  deactivateEmployee as deactivateEmployeeCommand,
  executeCommand,
  executeQuery,
  getEmployee as getEmployeeQuery,
  getHrChoices as getHrChoicesQuery,
  getLeaveScreen as getLeaveScreenQuery,
  listEmployees as listEmployeesQuery,
  listHolidays as listHolidaysQuery,
  listLeaveTypes as listLeaveTypesQuery,
  listShifts as listShiftsQuery,
  rejectLeave as rejectLeaveCommand,
  requestLeave as requestLeaveCommand,
  setHoliday as setHolidayCommand,
  setLeaveType as setLeaveTypeCommand,
  setShift as setShiftCommand,
  updateEmployee as updateEmployeeCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// Thin wrappers (docs/06-api.md §4) for HR1's screens (docs/03-roadmap-appendix/phase5.md §5):
// parse → request context → command or query → DTO. Every one runs in the caller's own request,
// the companies they act in: the commands check the company named, and a group setting needs a
// request covering every company.

async function hrCommand<T>(
  action: string,
  schema: Schema<unknown>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      { requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

export async function createEmployee(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<EmployeeDto>> {
  return hrCommand(
    'createEmployee',
    CreateEmployeeInput,
    createEmployeeCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function updateEmployee(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<EmployeeDto>> {
  return hrCommand(
    'updateEmployee',
    UpdateEmployeeInput,
    updateEmployeeCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function deactivateEmployee(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<EmployeeDto>> {
  return hrCommand(
    'deactivateEmployee',
    DeactivateEmployeeInput,
    deactivateEmployeeCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function setShift(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ShiftDto>> {
  return hrCommand('setShift', SetShiftInput, setShiftCommand, rawInput, idempotencyKey);
}

export async function setHoliday(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<HolidayDto>> {
  return hrCommand('setHoliday', SetHolidayInput, setHolidayCommand, rawInput, idempotencyKey);
}

export async function setLeaveType(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeaveTypeDto>> {
  return hrCommand(
    'setLeaveType',
    SetLeaveTypeInput,
    setLeaveTypeCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function requestLeave(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeaveRequestDto>> {
  return hrCommand(
    'requestLeave',
    RequestLeaveInput,
    requestLeaveCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function approveLeave(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeaveRequestDto>> {
  return hrCommand('approveLeave', DecideLeaveInput, approveLeaveCommand, rawInput, idempotencyKey);
}

export async function rejectLeave(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeaveRequestDto>> {
  return hrCommand('rejectLeave', DecideLeaveInput, rejectLeaveCommand, rawInput, idempotencyKey);
}

export async function cancelLeave(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeaveRequestDto>> {
  return hrCommand('cancelLeave', CancelLeaveInput, cancelLeaveCommand, rawInput, idempotencyKey);
}

export async function adjustLeave(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeaveMovementDto>> {
  return hrCommand('adjustLeave', AdjustLeaveInput, adjustLeaveCommand, rawInput, idempotencyKey);
}

/** HR › People, a page at a time. */
export async function listEmployees(rawInput: unknown): Promise<ActionResult<EmployeePageDto>> {
  return toResult('listEmployees', async () => {
    const principal = await signedIn();
    const input = parseInput(ListEmployeesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (ctx) => listEmployeesQuery(ctx, input), {
      name: 'listEmployees',
    });
  });
}

/** A person's page. */
export async function getEmployee(rawInput: unknown): Promise<ActionResult<EmployeeSheetDto>> {
  return toResult('getEmployee', async () => {
    const principal = await signedIn();
    const input = parseInput(GetEmployeeInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (ctx) => getEmployeeQuery(ctx, input), {
      name: 'getEmployee',
    });
  });
}

/** What HR's employee form offers for one company. */
export async function getHrChoices(rawInput: unknown): Promise<ActionResult<HrChoicesDto>> {
  return toResult('getHrChoices', async () => {
    const principal = await signedIn();
    const input = parseInput(HrChoicesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (ctx) => getHrChoicesQuery(ctx, input), {
      name: 'getHrChoices',
    });
  });
}

/** HR › Leave: the caller's own leave and what waits for their decision. */
export async function getLeaveScreen(): Promise<ActionResult<LeaveScreenDto>> {
  return toResult('getLeaveScreen', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (ctx) => getLeaveScreenQuery(ctx), {
      name: 'getLeaveScreen',
    });
  });
}

export async function listShifts(rawInput: unknown): Promise<ActionResult<ShiftListDto>> {
  return toResult('listShifts', async () => {
    const principal = await signedIn();
    const input = parseInput(ListShiftsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (ctx) => listShiftsQuery(ctx, input), {
      name: 'listShifts',
    });
  });
}

export async function listLeaveTypes(rawInput: unknown): Promise<ActionResult<LeaveTypeListDto>> {
  return toResult('listLeaveTypes', async () => {
    const principal = await signedIn();
    const input = parseInput(ListLeaveTypesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (ctx) => listLeaveTypesQuery(ctx, input), {
      name: 'listLeaveTypes',
    });
  });
}

export async function listHolidays(rawInput: unknown): Promise<ActionResult<HolidayListDto>> {
  return toResult('listHolidays', async () => {
    const principal = await signedIn();
    const input = parseInput(ListHolidaysInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (ctx) => listHolidaysQuery(ctx, input), {
      name: 'listHolidays',
    });
  });
}
