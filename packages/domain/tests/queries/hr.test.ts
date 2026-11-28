import {
  newId,
  type EmployeeDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
  type Principal,
  type RoleKey,
  type ShiftDto,
} from '@shakti/contracts';
import {
  ALL_ENTITY_IDS,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createEmployee, deactivateEmployee } from '../../src/commands/hr/employees';
import { adjustLeave, approveLeave, requestLeave } from '../../src/commands/hr/leave';
import { setHoliday, setLeaveType, setShift } from '../../src/commands/hr/settings';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  getEmployee,
  getHrChoices,
  getLeaveScreen,
  listEmployees,
  listHolidays,
  listLeaveTypes,
  listShifts,
} from '../../src/queries/hr/hr';

// HR1's reads (docs/03-roadmap-appendix/phase5.md §5): the directory, a person's page, the leave
// screen and HR's settings, each read under the caller's own row security. The people, shifts and
// leave types are this file's own, in company 3, with a random tag in every name; the leave dates
// are in June 2032 and the holiday in 2033, far from the command tests' March 2031. Every figure is
// a synthetic test value, never a client's leave rule.

const E = 3;
const OTHER = 4;
const TAG = newId().slice(-6);
const NOW = new Date();

let hr: Principal;
let gm: Principal;
let lead: Principal;
let callerA: Principal;
let callerB: Principal;

let shift: ShiftDto;
let casual: LeaveTypeDto;
let unused: LeaveTypeDto;
let leadEmployee: EmployeeDto;
let aEmployee: EmployeeDto;
let bEmployee: EmployeeDto;
let helper: EmployeeDto;
let left: EmployeeDto;
let aWaiting: LeaveRequestDto;
let leadWaiting: LeaveRequestDto;

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, now: NOW }, input),
  ) as Promise<T>;
}

async function person(role: RoleKey, name: string, entityIds: number[] = [E]): Promise<Principal> {
  const user = await createTestUser([{ entityId: E, roleKey: role }], { name });
  return createTestPrincipal(role, entityIds, { id: user.id });
}

const employee = (name: string, extra: Record<string, unknown> = {}) =>
  run<EmployeeDto>(hr, createEmployee, {
    entityId: E,
    name: `${name} ${TAG}`,
    joinedOn: '2031-01-01',
    ...extra,
  });

/** The tagged names a reader finds in the directory, in its order. */
async function directory(reader: Principal, extra: Record<string, unknown> = {}) {
  const page = await asPrincipal(reader, (ctx) =>
    listEmployees(ctx, { q: TAG, limit: 200, ...extra }),
  );
  return page.items.map((i) => i.name);
}

beforeAll(async () => {
  hr = await person('hr_admin', 'HR Reads Admin', [...ALL_ENTITY_IDS]);
  gm = await person('general_manager', 'HR Reads GM');
  lead = await person('sales_team_lead', 'HR Reads Lead');
  callerA = await person('tele_caller_cc', 'HR Reads Caller A');
  callerB = await person('tele_caller_lc', 'HR Reads Caller B');

  shift = await run<ShiftDto>(hr, setShift, {
    entityId: E,
    name: `Reads day ${TAG}`,
    startTime: '09:30',
    endTime: '18:00',
    lunchMinutes: 30,
    graceMinutes: 10,
    weeklyOffDays: [7],
  });
  casual = await run<LeaveTypeDto>(hr, setLeaveType, {
    entityId: E,
    name: `Reads casual ${TAG}`,
    daysPerYear: 12,
    carriesForward: false,
    paid: true,
  });
  unused = await run<LeaveTypeDto>(hr, setLeaveType, {
    entityId: E,
    name: `Reads unused ${TAG}`,
    daysPerYear: 6,
    carriesForward: false,
    paid: false,
  });
  leadEmployee = await employee('Lead', { userId: lead.id, shiftId: shift.id });
  aEmployee = await employee('Asha', {
    userId: callerA.id,
    managerId: leadEmployee.id,
    office: 'Jaipur',
  });
  bEmployee = await employee('Bina', { userId: callerB.id });
  helper = await employee('Chetan', { managerId: leadEmployee.id });
  left = await employee('Dev', { managerId: leadEmployee.id });
  await run(hr, deactivateEmployee, { id: left.id, leftOn: '2031-06-30' });

  await run(hr, adjustLeave, {
    employeeId: aEmployee.id,
    leaveTypeId: casual.id,
    kind: 'grant',
    days: 10,
    reason: 'Test grant',
  });
  // One approved request (the balance falls by its days) and one waiting for the lead.
  const approved = await run<LeaveRequestDto>(callerA, requestLeave, {
    employeeId: aEmployee.id,
    leaveTypeId: casual.id,
    fromDate: '2032-06-01',
    toDate: '2032-06-02',
  });
  await run(lead, approveLeave, { id: approved.id });
  aWaiting = await run<LeaveRequestDto>(callerA, requestLeave, {
    employeeId: aEmployee.id,
    leaveTypeId: casual.id,
    fromDate: '2032-06-14',
    toDate: '2032-06-14',
    note: `Family function ${TAG}`,
  });
  leadWaiting = await run<LeaveRequestDto>(lead, requestLeave, {
    employeeId: leadEmployee.id,
    leaveTypeId: casual.id,
    fromDate: '2032-06-15',
    toDate: '2032-06-15',
  });
  await run(hr, setHoliday, { entityId: E, date: '2033-01-26', name: `Reads holiday ${TAG}` });
});

afterAll(closeDb);

describe('listEmployees', () => {
  it('HR reads every person by name; people who left only when asked', async () => {
    expect(await directory(hr)).toEqual([
      `Asha ${TAG}`,
      `Bina ${TAG}`,
      `Chetan ${TAG}`,
      `Lead ${TAG}`,
    ]);
    expect(await directory(hr, { includeLeft: true })).toContain(`Dev ${TAG}`);
  });

  it('the GM reads their company; a team lead themselves and the people they manage; a person only themselves', async () => {
    expect(await directory(gm)).toHaveLength(4);
    expect(await directory(lead)).toEqual([`Asha ${TAG}`, `Chetan ${TAG}`, `Lead ${TAG}`]);
    expect(await directory(callerA)).toEqual([`Asha ${TAG}`]);
    expect(await directory(callerB)).toEqual([`Bina ${TAG}`]);
  });

  it('pages by name with no row twice, and carries the manager, shift and sign-in', async () => {
    const names: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 5; pages++) {
      const page = await asPrincipal(hr, (ctx) =>
        listEmployees(ctx, { q: TAG, limit: 3, cursor, includeLeft: true }),
      );
      names.push(...page.items.map((i) => i.name));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(names).toEqual([
      `Asha ${TAG}`,
      `Bina ${TAG}`,
      `Chetan ${TAG}`,
      `Dev ${TAG}`,
      `Lead ${TAG}`,
    ]);
    const page = await asPrincipal(hr, (ctx) => listEmployees(ctx, { q: `Asha ${TAG}` }));
    expect(page.items[0]).toMatchObject({
      managerName: `Lead ${TAG}`,
      shiftName: null,
      office: 'Jaipur',
      signsIn: true,
      active: true,
    });
    const leadRow = await asPrincipal(hr, (ctx) => listEmployees(ctx, { q: `Lead ${TAG}` }));
    expect(leadRow.items[0]?.shiftName).toBe(`Reads day ${TAG}`);
  });

  it('acting in another company, HR reads none of company 3', async () => {
    const hrInOther = await createTestPrincipal('hr_admin', [OTHER], { id: hr.id });
    expect(await directory(hrInOther)).toEqual([]);
  });
});

describe('getEmployee', () => {
  it('a person’s page sums the movements of each leave type offered to their company', async () => {
    const sheet = await asPrincipal(callerA, (ctx) => getEmployee(ctx, { id: aEmployee.id }));
    expect(sheet.managerName).toBe(`Lead ${TAG}`);
    expect(sheet.balances).toEqual(
      expect.arrayContaining([
        { leaveTypeId: casual.id, leaveTypeName: casual.name, days: 8 },
        { leaveTypeId: unused.id, leaveTypeName: unused.name, days: 0 },
      ]),
    );
    expect(sheet.requests.map((r) => r.state)).toEqual(['requested', 'approved']);
    expect(sheet.movements.map((m) => [m.kind, m.days])).toEqual([
      ['use', -2],
      ['grant', 10],
    ]);
    const leadSheet = await asPrincipal(lead, (ctx) => getEmployee(ctx, { id: leadEmployee.id }));
    expect(leadSheet.shift?.name).toBe(`Reads day ${TAG}`);
  });

  it('gives the phone to HR alone: a team lead and the GM read the record without it', async () => {
    const withPhone = await employee('Esha', { managerId: leadEmployee.id, phone: '98111 22334' });
    const asHr = await asPrincipal(hr, (ctx) => getEmployee(ctx, { id: withPhone.id }));
    expect(asHr).toMatchObject({ phoneShown: true, employee: { phone: '+919811122334' } });
    for (const reader of [lead, gm]) {
      const sheet = await asPrincipal(reader, (ctx) => getEmployee(ctx, { id: withPhone.id }));
      expect(sheet).toMatchObject({ phoneShown: false, employee: { phone: null } });
    }
  });

  it('is not found to someone who may not read the record', async () => {
    const error: unknown = await asPrincipal(callerB, (ctx) =>
      getEmployee(ctx, { id: aEmployee.id }),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'not_found', details: { reason: 'employee_missing' } });
    await expect(
      asPrincipal(lead, (ctx) => getEmployee(ctx, { id: bEmployee.id })),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('getLeaveScreen', () => {
  it('a person sees their own record, types, balance and requests, and nothing to decide', async () => {
    const screen = await asPrincipal(callerA, (ctx) => getLeaveScreen(ctx));
    expect(screen.own).toEqual([{ id: aEmployee.id, entityId: E, name: `Asha ${TAG}` }]);
    expect(screen.leaveTypes.map((t) => t.id)).toEqual(
      expect.arrayContaining([casual.id, unused.id]),
    );
    expect(screen.balances).toEqual([
      expect.objectContaining({ employeeId: aEmployee.id, leaveTypeId: casual.id, days: 8 }),
    ]);
    expect(screen.requests.map((r) => r.id)).toContain(aWaiting.id);
    expect(screen.toDecide).toEqual([]);
  });

  it('a team lead decides their team’s waiting requests with the balance, never their own', async () => {
    const screen = await asPrincipal(lead, (ctx) => getLeaveScreen(ctx));
    expect(screen.toDecide.map((r) => r.id)).toEqual([aWaiting.id]);
    expect(screen.toDecide[0]).toMatchObject({
      employeeName: `Asha ${TAG}`,
      leaveTypeName: casual.name,
      days: 1,
      balance: 8,
      note: `Family function ${TAG}`,
    });
    expect(screen.requests.map((r) => r.id)).toEqual([leadWaiting.id]);
  });

  it('someone with no staff record sees no form and no requests', async () => {
    const stranger = await person('tele_caller_cc', 'HR Reads Stranger');
    const screen = await asPrincipal(stranger, (ctx) => getLeaveScreen(ctx));
    expect(screen).toMatchObject({ own: [], leaveTypes: [], balances: [], requests: [] });
  });
});

describe('the settings lists and the form’s choices', () => {
  it('lists shifts and leave types in use; archived ones only when asked', async () => {
    await run(hr, setLeaveType, {
      id: unused.id,
      entityId: E,
      name: unused.name,
      daysPerYear: 6,
      carriesForward: false,
      paid: false,
      archived: true,
    });
    const types = await asPrincipal(callerA, (ctx) => listLeaveTypes(ctx, {}));
    expect(types.leaveTypes.map((t) => t.id)).toContain(casual.id);
    expect(types.leaveTypes.map((t) => t.id)).not.toContain(unused.id);
    const all = await asPrincipal(hr, (ctx) => listLeaveTypes(ctx, { includeArchived: true }));
    expect(all.leaveTypes.map((t) => t.id)).toContain(unused.id);
    const shifts = await asPrincipal(callerA, (ctx) => listShifts(ctx, {}));
    expect(shifts.shifts.map((s) => s.id)).toContain(shift.id);
  });

  it('lists the holidays of the year asked for', async () => {
    const year = await asPrincipal(callerA, (ctx) => listHolidays(ctx, { year: 2033 }));
    expect(year.holidays).toContainEqual(
      expect.objectContaining({ entityId: E, date: '2033-01-26', name: `Reads holiday ${TAG}` }),
    );
    const before = await asPrincipal(callerA, (ctx) => listHolidays(ctx, { year: 2032 }));
    expect(before.holidays.map((h) => h.name)).not.toContain(`Reads holiday ${TAG}`);
  });

  it('offers the company’s shifts, its staff as managers, and its people with no record yet', async () => {
    const newcomer = await person('store_manager', `HR Reads Newcomer ${TAG}`);
    const choices = await asPrincipal(hr, (ctx) => getHrChoices(ctx, { entityId: E }));
    expect(choices.shifts.map((s) => s.id)).toContain(shift.id);
    expect(choices.managers.map((m) => m.id)).toEqual(
      expect.arrayContaining([leadEmployee.id, aEmployee.id, helper.id]),
    );
    expect(choices.managers.map((m) => m.id)).not.toContain(left.id);
    expect(choices.people.map((p) => p.id)).toContain(newcomer.id);
    expect(choices.people.map((p) => p.id)).not.toContain(callerA.id);
    const hrInOther = await createTestPrincipal('hr_admin', [OTHER], { id: hr.id });
    await expect(
      asPrincipal(hrInOther, (ctx) => getHrChoices(ctx, { entityId: E })),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'config_company_scope' } });
  });
});
