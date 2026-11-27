import {
  newId,
  type EmployeeDto,
  type HolidayDto,
  type LeaveMovementDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
  type Principal,
  type RoleKey,
  type ShiftDto,
} from '@shakti/contracts';
import {
  ALL_ENTITY_IDS,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { failureOf, runCommand } from '../../src/command/run-command';
import {
  createEmployee,
  deactivateEmployee,
  updateEmployee,
} from '../../src/commands/hr/employees';
import {
  adjustLeave,
  approveLeave,
  cancelLeave,
  rejectLeave,
  requestLeave,
} from '../../src/commands/hr/leave';
import { setHoliday, setLeaveType, setShift } from '../../src/commands/hr/settings';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// HR1 (docs/03-roadmap-appendix/phase5.md §5, PRD HR-01 and HR-02): the directory, shifts,
// holidays, leave types and leave. The people, shifts, leave types and requests are this file's
// own, in company 3; names carry a random tag so a re-run never meets an earlier run's rows. The
// dates are in March 2031, far from any other file's, and the figures are synthetic test values,
// never a client's leave rule.

const E = 3;
const OTHER = 4;
const TAG = newId().slice(-6);
const NOW = new Date();

let hr: Principal;
let exec: Principal;
let gm: Principal;
let lead: Principal;
let callerA: Principal;
let callerB: Principal;
let store: Principal;
let otherLead: Principal;

let leadEmployee: EmployeeDto;
let aEmployee: EmployeeDto;
let bEmployee: EmployeeDto;
let fieldWorker: EmployeeDto;
let shift: ShiftDto;
let casual: LeaveTypeDto;

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, now: NOW }, input),
  ) as Promise<T>;
}

async function failure(principal: Principal, command: AnyCommand, input: unknown) {
  const error: unknown = await run(principal, command, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  const e = error as { code?: string; details?: { reason?: unknown } } | undefined;
  return { code: e?.code, reason: e?.details?.reason, stage: failureOf(error)?.stage };
}

/** A person with a role in company 3, signed in through their own principal. */
async function person(role: RoleKey, name: string, entityIds: number[] = [E]): Promise<Principal> {
  const user = await createTestUser([{ entityId: E, roleKey: role }], { name });
  return createTestPrincipal(role, entityIds, { id: user.id });
}

/** The sum of a person's movements of a leave type, as the person themselves reads it. */
async function balanceAs(reader: Principal, employeeId: string, leaveTypeId: string) {
  return asPrincipal(reader, async ({ tx }) => {
    const rows = (await tx.execute(sql`
      select coalesce(sum(days), 0)::float8 as n, count(*)::int as movements
        from leave_balances where employee_id = ${employeeId} and leave_type_id = ${leaveTypeId}`)) as unknown as {
      n: number;
      movements: number;
    }[];
    return rows[0] ?? { n: 0, movements: 0 };
  });
}

const employeeInput = (extra: Record<string, unknown> = {}) => ({
  entityId: E,
  name: `HR person ${TAG}`,
  joinedOn: '2030-01-01',
  ...extra,
});

beforeAll(async () => {
  hr = await person('hr_admin', 'HR Admin', [...ALL_ENTITY_IDS]);
  exec = await person('executive', 'HR Exec', [...ALL_ENTITY_IDS]);
  gm = await person('general_manager', 'HR GM');
  lead = await person('sales_team_lead', 'HR Lead');
  otherLead = await person('sales_team_lead', 'HR Other Lead');
  callerA = await person('tele_caller_cc', 'HR Caller A');
  callerB = await person('tele_caller_lc', 'HR Caller B');
  store = await person('store_manager', 'HR Store');

  shift = await run<ShiftDto>(hr, setShift, {
    entityId: E,
    name: `Day ${TAG}`,
    startTime: '09:30',
    endTime: '18:00',
    lunchMinutes: 30,
    graceMinutes: 10,
    weeklyOffDays: [7],
  });
  casual = await run<LeaveTypeDto>(hr, setLeaveType, {
    entityId: E,
    name: `Casual ${TAG}`,
    daysPerYear: 12,
    carriesForward: false,
    paid: true,
  });
  leadEmployee = await run<EmployeeDto>(
    hr,
    createEmployee,
    employeeInput({ userId: lead.id, name: 'HR Lead', shiftId: shift.id }),
  );
  aEmployee = await run<EmployeeDto>(
    hr,
    createEmployee,
    employeeInput({
      userId: callerA.id,
      name: 'HR Caller A',
      managerId: leadEmployee.id,
      shiftId: shift.id,
      phone: '98765 43210',
    }),
  );
  bEmployee = await run<EmployeeDto>(
    hr,
    createEmployee,
    employeeInput({ userId: callerB.id, name: 'HR Caller B', shiftId: shift.id }),
  );
  fieldWorker = await run<EmployeeDto>(
    hr,
    createEmployee,
    employeeInput({ name: `Helper ${TAG}`, managerId: leadEmployee.id }),
  );
  // The other team lead is on the staff too, managing nobody.
  await run(hr, createEmployee, employeeInput({ userId: otherLead.id, name: 'HR Other Lead' }));
});

afterAll(closeDb);

describe('hr.employee.create, .update and .deactivate', () => {
  it('HR keeps a record with a sign-in, a manager, a shift and a phone in E.164', () => {
    expect(aEmployee).toMatchObject({
      entityId: E,
      userId: callerA.id,
      managerId: leadEmployee.id,
      shiftId: shift.id,
      phone: '+919876543210',
      active: true,
      leftOn: null,
    });
    expect(fieldWorker.userId).toBeNull();
  });

  it('records no phone digits in the audit trail', async () => {
    const rows = await asPrincipal(
      exec,
      async ({ tx }) =>
        (await tx.execute(sql`
        select after_json::text as after from audit_logs
         where command = 'hr.employee.create' and aggregate_id = ${aEmployee.id}`)) as unknown as {
          after: string;
        }[],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toContain('"phoneOnRecord": true');
    expect(rows[0]?.after).not.toMatch(/3210|98765/);
  });

  it('is refused to a GM, a team lead and an agent: forbidden', async () => {
    for (const p of [gm, lead]) {
      expect(await failure(p, createEmployee, employeeInput())).toMatchObject({
        code: 'forbidden',
        stage: 'guard',
      });
    }
    const agent = await createTestPrincipal('agent:triage', [E]);
    expect((await failure(agent, createEmployee, employeeInput())).code).toBe('forbidden');
    const editable = {
      id: aEmployee.id,
      userId: aEmployee.userId,
      name: 'Renamed',
      phone: null,
      managerId: null,
      shiftId: null,
      office: null,
      joinedOn: '2030-01-01',
    };
    expect((await failure(lead, updateEmployee, editable)).code).toBe('forbidden');
    expect(
      (await failure(gm, deactivateEmployee, { id: aEmployee.id, leftOn: '2031-01-01' })).code,
    ).toBe('forbidden');
  });

  it('is refused for another company outside the request', async () => {
    const hrInOther = await createTestPrincipal('hr_admin', [OTHER], { id: hr.id });
    expect(await failure(hrInOther, createEmployee, employeeInput())).toMatchObject({
      code: 'forbidden',
      reason: 'config_company_scope',
    });
    // The record of company 3 is not visible acting in another company.
    expect(
      await failure(hrInOther, updateEmployee, {
        id: aEmployee.id,
        userId: null,
        name: 'x',
        phone: null,
        managerId: null,
        shiftId: null,
        office: null,
        joinedOn: '2030-01-01',
      }),
    ).toMatchObject({ code: 'not_found', reason: 'employee_missing' });
    expect(
      await failure(hrInOther, deactivateEmployee, { id: aEmployee.id, leftOn: '2031-01-01' }),
    ).toMatchObject({ code: 'not_found', reason: 'employee_missing' });
  });

  it('refuses a sign-in of someone with no role in the company, twice the same person, and a manager loop', async () => {
    const outsider = await createTestUser([{ entityId: OTHER, roleKey: 'tele_caller_cc' }]);
    expect(await failure(hr, createEmployee, employeeInput({ userId: outsider.id }))).toMatchObject(
      { code: 'validation_failed', reason: 'employee_user_not_in_company' },
    );
    expect(await failure(hr, createEmployee, employeeInput({ userId: callerA.id }))).toMatchObject({
      code: 'conflict',
      reason: 'employee_user_taken',
    });
    // The lead's manager may not be someone who reports to the lead.
    expect(
      await failure(hr, updateEmployee, {
        id: leadEmployee.id,
        userId: lead.id,
        name: 'HR Lead',
        phone: null,
        managerId: aEmployee.id,
        shiftId: shift.id,
        office: null,
        joinedOn: '2030-01-01',
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'employee_manager_cycle' });
    expect(await failure(hr, createEmployee, employeeInput({ managerId: newId() }))).toMatchObject({
      code: 'validation_failed',
      reason: 'employee_manager_missing',
    });
  });

  it('HR updates a record and records when someone left; a person who left is not changed again', async () => {
    const temp = await run<EmployeeDto>(hr, createEmployee, employeeInput({ office: 'Nashik' }));
    const updated = await run<EmployeeDto>(hr, updateEmployee, {
      id: temp.id,
      userId: null,
      name: `Moved ${TAG}`,
      phone: '+919812345678',
      managerId: leadEmployee.id,
      shiftId: shift.id,
      office: 'Pune',
      joinedOn: '2030-02-01',
    });
    expect(updated).toMatchObject({ name: `Moved ${TAG}`, office: 'Pune', joinedOn: '2030-02-01' });
    expect(
      await failure(hr, deactivateEmployee, { id: temp.id, leftOn: '2030-01-15' }),
    ).toMatchObject({ code: 'validation_failed', reason: 'employee_left_before_joining' });
    const left = await run<EmployeeDto>(hr, deactivateEmployee, {
      id: temp.id,
      leftOn: '2030-12-31',
    });
    expect(left).toMatchObject({ active: false, leftOn: '2030-12-31' });
    expect(
      await failure(hr, deactivateEmployee, { id: temp.id, leftOn: '2031-01-01' }),
    ).toMatchObject({ code: 'conflict', reason: 'employee_inactive' });
    expect(
      await failure(hr, requestLeave, {
        employeeId: temp.id,
        leaveTypeId: casual.id,
        fromDate: '2031-03-03',
        toDate: '2031-03-03',
      }),
    ).toMatchObject({ code: 'conflict', reason: 'employee_inactive' });
  });
});

describe('hr.shift.set, hr.holiday.set and hr.leave_type.set', () => {
  it('HR keeps a company shift, renames it and archives it; the company stays', async () => {
    const made = await run<ShiftDto>(hr, setShift, {
      entityId: E,
      name: `Night ${TAG}`,
      startTime: '22:00',
      endTime: '06:00',
      lunchMinutes: 30,
      graceMinutes: 5,
      weeklyOffDays: [7, 6],
    });
    expect(made).toMatchObject({ weeklyOffDays: [6, 7], archived: false });
    const archived = await run<ShiftDto>(hr, setShift, {
      ...made,
      name: `Night two ${TAG}`,
      archived: true,
    });
    expect(archived).toMatchObject({ name: `Night two ${TAG}`, archived: true });
    expect(await failure(hr, setShift, { ...made, entityId: OTHER })).toMatchObject({
      code: 'validation_failed',
      reason: 'hr_setting_company_fixed',
    });
    expect(
      await failure(hr, setShift, { ...shift, id: undefined, name: shift.name.toUpperCase() }),
    ).toMatchObject({ code: 'conflict', reason: 'shift_name_taken' });
  });

  it('a group-wide setting needs every company in the request, and another company outside the request is refused', async () => {
    const hrInE = await createTestPrincipal('hr_admin', [E], { id: hr.id });
    const group = {
      entityId: null,
      name: `Group ${TAG}`,
      startTime: '10:00',
      endTime: '19:00',
      lunchMinutes: 45,
      graceMinutes: 15,
      weeklyOffDays: [],
    };
    expect(await failure(hrInE, setShift, group)).toMatchObject({
      code: 'forbidden',
      reason: 'config_group_scope',
    });
    expect(await failure(hrInE, setShift, { ...group, entityId: OTHER })).toMatchObject({
      code: 'forbidden',
      reason: 'config_company_scope',
    });
    expect(
      await failure(hrInE, setHoliday, { entityId: OTHER, date: '2031-03-05', name: 'Day' }),
    ).toMatchObject({ code: 'forbidden', reason: 'config_company_scope' });
    expect(
      await failure(hrInE, setLeaveType, {
        entityId: OTHER,
        name: 'x',
        daysPerYear: 1,
        carriesForward: false,
        paid: false,
      }),
    ).toMatchObject({ code: 'forbidden', reason: 'config_company_scope' });
    const made = await run<ShiftDto>(hr, setShift, group);
    expect(made.entityId).toBeNull();
    await run(hr, setShift, { ...made, archived: true });
  });

  it('is refused to anyone without hr.employee.write: forbidden', async () => {
    const holiday = { entityId: E, date: '2031-03-05', name: 'Day' };
    for (const p of [gm, lead, callerA]) {
      expect((await failure(p, setShift, { ...shift, id: undefined, name: 'x' })).code).toBe(
        'forbidden',
      );
      expect((await failure(p, setHoliday, holiday)).code).toBe('forbidden');
      expect(
        (
          await failure(p, setLeaveType, {
            entityId: E,
            name: 'x',
            daysPerYear: 1,
            carriesForward: false,
            paid: false,
          })
        ).code,
      ).toBe('forbidden');
    }
  });

  it('HR names a holiday, renames it and takes it off again', async () => {
    const set = await run<HolidayDto>(hr, setHoliday, {
      entityId: E,
      date: '2031-04-14',
      name: 'Holiday one',
    });
    expect(set).toMatchObject({ entityId: E, date: '2031-04-14', name: 'Holiday one' });
    const renamed = await run<HolidayDto>(hr, setHoliday, {
      entityId: E,
      date: '2031-04-14',
      name: 'Holiday two',
    });
    expect(renamed).toMatchObject({ id: set.id, name: 'Holiday two' });
    const removed = await run<HolidayDto>(hr, setHoliday, {
      entityId: E,
      date: '2031-04-14',
      name: null,
    });
    expect(removed).toMatchObject({ id: null, name: null });
    // Removing a day with no holiday changes nothing.
    await expect(
      run<HolidayDto>(hr, setHoliday, { entityId: E, date: '2031-04-14', name: null }),
    ).resolves.toMatchObject({ id: null });
  });

  it('HR keeps a leave type and archives it, which takes it off new requests', async () => {
    const sick = await run<LeaveTypeDto>(hr, setLeaveType, {
      entityId: E,
      name: `Sick ${TAG}`,
      daysPerYear: 7.5,
      carriesForward: true,
      paid: true,
    });
    expect(sick).toMatchObject({ daysPerYear: 7.5, carriesForward: true, paid: true });
    await run(hr, setLeaveType, { ...sick, archived: true });
    expect(
      await failure(callerA, requestLeave, {
        employeeId: aEmployee.id,
        leaveTypeId: sick.id,
        fromDate: '2031-03-03',
        toDate: '2031-03-03',
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'leave_type_missing' });
  });
});

describe('leave: a person asks, the manager approves, the balance falls', () => {
  it('counts the working days by the shift and the holidays, and the approval takes them off once', async () => {
    await run(hr, setHoliday, { entityId: E, date: '2031-03-12', name: 'Test holiday' });
    const grant = await run<LeaveMovementDto>(hr, adjustLeave, {
      employeeId: aEmployee.id,
      leaveTypeId: casual.id,
      kind: 'grant',
      days: 12,
      reason: 'Opening balance',
    });
    expect(grant).toMatchObject({ kind: 'grant', days: 12, leaveRequestId: null });
    expect((await balanceAs(callerA, aEmployee.id, casual.id)).n).toBe(12);

    // Monday 10-03-2031 to Sunday 16-03-2031: Sunday off, Wednesday a holiday.
    const asked = await run<LeaveRequestDto>(callerA, requestLeave, {
      employeeId: aEmployee.id,
      leaveTypeId: casual.id,
      fromDate: '2031-03-10',
      toDate: '2031-03-16',
      note: 'Family function',
    });
    expect(asked).toMatchObject({ state: 'requested', days: 5, entityId: E });

    const approved = await run<LeaveRequestDto>(lead, approveLeave, { id: asked.id });
    expect(approved).toMatchObject({ state: 'approved', days: 5 });
    expect(approved.decidedAt).not.toBeNull();
    expect(await balanceAs(callerA, aEmployee.id, casual.id)).toEqual({ n: 7, movements: 2 });

    // A second approval is refused by the machine; the balance stays.
    expect(await failure(lead, approveLeave, { id: asked.id })).toMatchObject({
      code: 'conflict',
      reason: 'leave_request_transition_not_allowed',
    });
    expect(await balanceAs(hr, aEmployee.id, casual.id)).toEqual({ n: 7, movements: 2 });

    const events = await asOutboxPublisher(
      (p) => p<{ payload: Record<string, unknown> }[]>`
        select payload_json as payload from outbox_events
         where type = 'hr.leave.approved' and aggregate_id = ${asked.id}`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      employeeId: aEmployee.id,
      fromDate: '2031-03-10',
      toDate: '2031-03-16',
    });
  });

  it('refuses an overlapping request and a span with no working day', async () => {
    expect(
      await failure(callerA, requestLeave, {
        employeeId: aEmployee.id,
        leaveTypeId: casual.id,
        fromDate: '2031-03-14',
        toDate: '2031-03-18',
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'leave_overlaps' });
    expect(
      await failure(callerA, requestLeave, {
        employeeId: aEmployee.id,
        leaveTypeId: casual.id,
        fromDate: '2031-03-23',
        toDate: '2031-03-23',
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'leave_no_working_days' });
    expect(
      await failure(callerA, requestLeave, {
        employeeId: aEmployee.id,
        leaveTypeId: casual.id,
        fromDate: '2031-03-20',
        toDate: '2031-03-19',
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'leave_dates_backwards' });
  });

  it('never lets anyone approve their own leave: forbidden', async () => {
    const own = await run<LeaveRequestDto>(lead, requestLeave, {
      employeeId: leadEmployee.id,
      leaveTypeId: casual.id,
      fromDate: '2031-03-03',
      toDate: '2031-03-04',
    });
    expect(await failure(lead, approveLeave, { id: own.id })).toMatchObject({
      code: 'forbidden',
      reason: 'leave_own_decision',
    });
    expect(await failure(lead, rejectLeave, { id: own.id })).toMatchObject({
      code: 'forbidden',
      reason: 'leave_own_decision',
    });
    // The GM decides the lead's leave.
    await expect(run(gm, approveLeave, { id: own.id })).resolves.toMatchObject({
      state: 'approved',
    });
  });

  it('a team lead decides only for the people they manage; the GM for the company: forbidden otherwise', async () => {
    const bAsks = await run<LeaveRequestDto>(callerB, requestLeave, {
      employeeId: bEmployee.id,
      leaveTypeId: casual.id,
      fromDate: '2031-03-03',
      toDate: '2031-03-03',
    });
    // The lead does not manage B, so cannot read the request at all.
    expect(await failure(lead, approveLeave, { id: bAsks.id })).toMatchObject({
      code: 'not_found',
      reason: 'leave_request_missing',
    });
    // Neither a caller nor a store manager may decide: no hr.leave.approve.
    for (const p of [callerA, store]) {
      expect((await failure(p, approveLeave, { id: bAsks.id })).code).toBe('forbidden');
      expect((await failure(p, rejectLeave, { id: bAsks.id })).code).toBe('forbidden');
    }
    const rejected = await run<LeaveRequestDto>(gm, rejectLeave, {
      id: bAsks.id,
      note: 'Short of staff that day',
    });
    expect(rejected).toMatchObject({ state: 'rejected', decisionNote: 'Short of staff that day' });
    expect((await balanceAs(callerB, bEmployee.id, casual.id)).movements).toBe(0);
  });

  it('a person asks only for their own leave; HR asks for someone with no sign-in', async () => {
    expect(
      await failure(callerA, requestLeave, {
        employeeId: bEmployee.id,
        leaveTypeId: casual.id,
        fromDate: '2031-03-24',
        toDate: '2031-03-24',
      }),
    ).toMatchObject({ code: 'not_found', reason: 'employee_missing' });
    // The lead reads the helper's record (they manage them) but asks only for themselves.
    expect(
      await failure(lead, requestLeave, {
        employeeId: fieldWorker.id,
        leaveTypeId: casual.id,
        fromDate: '2031-03-24',
        toDate: '2031-03-24',
      }),
    ).toMatchObject({ code: 'forbidden', reason: 'leave_for_someone_else' });
    const forHelper = await run<LeaveRequestDto>(hr, requestLeave, {
      employeeId: fieldWorker.id,
      leaveTypeId: casual.id,
      fromDate: '2031-03-24',
      toDate: '2031-03-30',
    });
    // No shift: every day of the week counts.
    expect(forHelper.days).toBe(7);
    await expect(run(lead, approveLeave, { id: forHelper.id })).resolves.toMatchObject({
      state: 'approved',
    });
    expect(await balanceAs(hr, fieldWorker.id, casual.id)).toEqual({ n: -7, movements: 1 });
  });

  it('the person who asked cancels while it waits; nobody else may: forbidden', async () => {
    const asked = await run<LeaveRequestDto>(callerA, requestLeave, {
      employeeId: aEmployee.id,
      leaveTypeId: casual.id,
      fromDate: '2031-04-07',
      toDate: '2031-04-08',
    });
    expect(await failure(lead, cancelLeave, { id: asked.id })).toMatchObject({
      code: 'forbidden',
      reason: 'leave_cancel_not_yours',
    });
    const cancelled = await run<LeaveRequestDto>(callerA, cancelLeave, { id: asked.id });
    expect(cancelled.state).toBe('cancelled');
    expect(await failure(callerA, cancelLeave, { id: asked.id })).toMatchObject({
      code: 'conflict',
      reason: 'leave_request_transition_not_allowed',
    });
    // The days are free again for a new request.
    await expect(
      run(callerA, requestLeave, {
        employeeId: aEmployee.id,
        leaveTypeId: casual.id,
        fromDate: '2031-04-07',
        toDate: '2031-04-07',
      }),
    ).resolves.toMatchObject({ state: 'requested', days: 1 });
  });

  it('leave in another company outside the request is not found, and agents are refused', async () => {
    const leadInOther = await createTestPrincipal('sales_team_lead', [OTHER], { id: lead.id });
    const asked = await run<LeaveRequestDto>(callerA, requestLeave, {
      employeeId: aEmployee.id,
      leaveTypeId: casual.id,
      fromDate: '2031-04-21',
      toDate: '2031-04-21',
    });
    expect(await failure(leadInOther, approveLeave, { id: asked.id })).toMatchObject({
      code: 'not_found',
      reason: 'leave_request_missing',
    });
    expect(await failure(leadInOther, rejectLeave, { id: asked.id })).toMatchObject({
      code: 'not_found',
    });
    const aInOther = await createTestPrincipal('tele_caller_cc', [OTHER], { id: callerA.id });
    expect(await failure(aInOther, cancelLeave, { id: asked.id })).toMatchObject({
      code: 'not_found',
    });
    expect(
      await failure(aInOther, requestLeave, {
        employeeId: aEmployee.id,
        leaveTypeId: casual.id,
        fromDate: '2031-04-22',
        toDate: '2031-04-22',
      }),
    ).toMatchObject({ code: 'not_found', reason: 'employee_missing' });
    const hrInOther = await createTestPrincipal('hr_admin', [OTHER], { id: hr.id });
    expect(
      await failure(hrInOther, adjustLeave, {
        employeeId: aEmployee.id,
        leaveTypeId: casual.id,
        kind: 'grant',
        days: 1,
        reason: 'x',
      }),
    ).toMatchObject({ code: 'not_found', reason: 'employee_missing' });
    const agent = await createTestPrincipal('agent:triage', [E]);
    for (const command of [requestLeave, approveLeave, cancelLeave, adjustLeave]) {
      expect((await failure(agent, command, { id: asked.id })).code).toMatch(
        /forbidden|validation_failed/,
      );
    }
  });

  it('only HR grants or corrects a balance, always with a reason: forbidden otherwise', async () => {
    const input = {
      employeeId: aEmployee.id,
      leaveTypeId: casual.id,
      kind: 'adjust',
      days: -0.5,
      reason: 'Half day taken in error',
    };
    for (const p of [gm, lead, callerA]) {
      expect((await failure(p, adjustLeave, input)).code).toBe('forbidden');
    }
    const before = (await balanceAs(hr, aEmployee.id, casual.id)).n;
    await expect(run(exec, adjustLeave, input)).resolves.toMatchObject({ days: -0.5 });
    expect((await balanceAs(hr, aEmployee.id, casual.id)).n).toBe(before - 0.5);
    expect((await failure(hr, adjustLeave, { ...input, kind: 'grant', days: -1 })).code).toBe(
      'validation_failed',
    );
    expect((await failure(hr, adjustLeave, { ...input, reason: ' ' })).code).toBe(
      'validation_failed',
    );
  });
});
