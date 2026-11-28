import {
  DomainError,
  EMPLOYEE_SHEET_ROWS,
  EmployeePageDto,
  EmployeeSheetDto,
  GetEmployeeInput,
  hasGrant,
  HolidayListDto,
  HrChoicesDto,
  HrChoicesInput,
  LEAVE_SCREEN_ROWS,
  LeaveScreenDto,
  LeaveTypeListDto,
  ListEmployeesInput,
  ListHolidaysInput,
  ListLeaveTypesInput,
  ListShiftsInput,
  ShiftListDto,
  type LeaveBalanceDto,
  type LeaveRequestRowDto,
} from '@shakti/contracts';
import { schema, type RequestContext, type RequestTx } from '@shakti/db';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  toEmployeeDto,
  toLeaveMovementDto,
  toLeaveRequestDto,
  toLeaveTypeDto,
  toShiftDto,
} from '../../hr/rows';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { containsPattern } from '../search-text';

/**
 * HR1's reads (docs/03-roadmap-appendix/phase5.md §5). Row security decides every row: a person
 * reads their own record and leave, a team lead the people they manage, the GM their company, HR
 * and the Executive everyone in the request's companies. The settings read acting in any company.
 */

type QueryContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const EmployeeCursor = z.object({ name: z.string(), id: z.string() }).strict();

/**
 * HR › People: the people the caller may read, by name, a page at a time; people who left only
 * when asked. The `(entity_id, lower(name), id)` index serves a company's page.
 */
export async function listEmployees(
  ctx: QueryContext,
  rawInput: unknown,
): Promise<EmployeePageDto> {
  const input = parseQueryInput(ListEmployeesInput, rawInput, 'hr.employees.list');
  const e = schema.employees;
  const m = alias(schema.employees, 'm');
  const s = schema.shifts;
  const after = input.cursor === undefined ? undefined : decodeCursor(EmployeeCursor, input.cursor);
  const sortName = sql<string>`lower(${e.name})`;
  const rows = await ctx.tx
    .select({
      id: e.id,
      entityId: e.entityId,
      name: e.name,
      sortName,
      office: e.office,
      joinedOn: e.joinedOn,
      active: e.active,
      // The caller's own row: their manager's record is not theirs to read (managerNameOf).
      managerName: sql<string | null>`coalesce(${m.name}, case when ${e.userId} = app.user_id()
        then app.hr_own_manager_name(${e.id}) end)`,
      shiftName: s.name,
      signsIn: sql<boolean>`${e.userId} is not null`,
    })
    .from(e)
    .leftJoin(m, eq(m.id, e.managerId))
    .leftJoin(s, eq(s.id, e.shiftId))
    .where(
      and(
        input.includeLeft ? undefined : eq(e.active, true),
        input.q === undefined ? undefined : ilike(e.name, containsPattern(input.q)),
        after === undefined
          ? undefined
          : sql`(lower(${e.name}), ${e.id}) > (${after.name}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(sortName, asc(e.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return EmployeePageDto.parse({
    items: page.map((r) => ({
      id: r.id,
      entityId: r.entityId,
      name: r.name,
      office: r.office,
      joinedOn: r.joinedOn,
      active: r.active,
      managerName: r.managerName,
      shiftName: r.shiftName,
      signsIn: r.signsIn,
    })),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ name: last.sortName, id: last.id })
        : null,
  });
}

/** Each leave type's balance of the given people: the sum of their movements, by type. */
async function balancesOf(
  tx: RequestTx,
  employeeIds: readonly string[],
): Promise<(LeaveBalanceDto & { employeeId: string })[]> {
  if (employeeIds.length === 0) return [];
  const b = schema.leaveBalances;
  const t = schema.leaveTypes;
  const rows = await tx
    .select({
      employeeId: b.employeeId,
      leaveTypeId: b.leaveTypeId,
      leaveTypeName: t.name,
      days: sql<string>`sum(${b.days})`,
    })
    .from(b)
    .innerJoin(t, eq(t.id, b.leaveTypeId))
    .where(inArray(b.employeeId, [...employeeIds]))
    .groupBy(b.employeeId, b.leaveTypeId, t.name)
    .orderBy(t.name);
  return rows.map((r) => ({ ...r, days: Number(r.days) }));
}

/** Requests with the person's and the leave type's names, newest first. */
async function requestRows(
  tx: RequestTx,
  where: ReturnType<typeof and>,
  order: 'newest' | 'oldestWaiting',
  limit: number,
): Promise<LeaveRequestRowDto[]> {
  const r = schema.leaveRequests;
  const e = schema.employees;
  const t = schema.leaveTypes;
  const rows = await tx
    .select({ request: r, employeeName: e.name, leaveTypeName: t.name })
    .from(r)
    .innerJoin(e, eq(e.id, r.employeeId))
    .innerJoin(t, eq(t.id, r.leaveTypeId))
    .where(where)
    .orderBy(
      ...(order === 'newest' ? [desc(r.fromDate), desc(r.id)] : [asc(r.createdAt), asc(r.id)]),
    )
    .limit(limit);
  return rows.map((row) => ({
    ...toLeaveRequestDto(row.request),
    employeeName: row.employeeName,
    leaveTypeName: row.leaveTypeName,
  }));
}

/**
 * The name of a person's manager. HR, the GM and the manager read the manager's record; a person
 * reads only their own, so for them the name comes from the one definer that answers it.
 */
async function managerNameOf(
  tx: RequestTx,
  row: { id: string; managerId: string | null },
): Promise<string | null> {
  if (row.managerId === null) return null;
  const e = schema.employees;
  const [readable] = await tx
    .select({ name: e.name })
    .from(e)
    .where(eq(e.id, row.managerId))
    .limit(1);
  if (readable) return readable.name;
  const rows = (await tx.execute(
    sql`select app.hr_own_manager_name(${row.id}::uuid) as name`,
  )) as unknown as { name: string | null }[];
  return rows[0]?.name ?? null;
}

/**
 * A person's page: their record, manager and shift; their balance of each leave type offered to
 * their company, and of any other type they hold days of; their newest requests and movements.
 */
export async function getEmployee(ctx: QueryContext, rawInput: unknown): Promise<EmployeeSheetDto> {
  const input = parseQueryInput(GetEmployeeInput, rawInput, 'hr.employees.get');
  const e = schema.employees;
  const [row] = await ctx.tx.select().from(e).where(eq(e.id, input.id)).limit(1);
  if (!row) {
    throw new DomainError('not_found', `employee ${input.id} is not readable`, {
      reason: 'employee_missing',
    });
  }
  const managerName = await managerNameOf(ctx.tx, row);
  const [shift] =
    row.shiftId === null
      ? []
      : await ctx.tx.select().from(schema.shifts).where(eq(schema.shifts.id, row.shiftId)).limit(1);
  const t = schema.leaveTypes;
  const offered = await ctx.tx
    .select({ id: t.id, name: t.name })
    .from(t)
    .where(and(isNull(t.archivedAt), or(isNull(t.entityId), eq(t.entityId, row.entityId))))
    .orderBy(asc(t.name));
  const held = await balancesOf(ctx.tx, [row.id]);
  const balances: LeaveBalanceDto[] = [
    ...offered.map((o) => ({
      leaveTypeId: o.id,
      leaveTypeName: o.name,
      days: held.find((h) => h.leaveTypeId === o.id)?.days ?? 0,
    })),
    ...held
      .filter((h) => !offered.some((o) => o.id === h.leaveTypeId))
      .map((h) => ({ leaveTypeId: h.leaveTypeId, leaveTypeName: h.leaveTypeName, days: h.days })),
  ];
  const requests = await requestRows(
    ctx.tx,
    and(eq(schema.leaveRequests.employeeId, row.id)),
    'newest',
    EMPLOYEE_SHEET_ROWS,
  );
  const b = schema.leaveBalances;
  const movements = await ctx.tx
    .select({ movement: b, leaveTypeName: t.name })
    .from(b)
    .innerJoin(t, eq(t.id, b.leaveTypeId))
    .where(eq(b.employeeId, row.id))
    .orderBy(desc(b.createdAt), desc(b.id))
    .limit(EMPLOYEE_SHEET_ROWS);
  return EmployeeSheetDto.parse({
    employee: toEmployeeDto(row),
    managerName,
    shift: shift === undefined ? null : toShiftDto(shift),
    balances,
    requests,
    movements: movements.map((m) => ({
      ...toLeaveMovementDto(m.movement),
      leaveTypeName: m.leaveTypeName,
    })),
  });
}

/**
 * What HR's employee form offers for one company: its shifts in use and the group's, the people
 * on its staff, and the people holding a role there with no staff record yet.
 */
export async function getHrChoices(ctx: QueryContext, rawInput: unknown): Promise<HrChoicesDto> {
  const input = parseQueryInput(HrChoicesInput, rawInput, 'hr.choices');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'company outside the request scope', {
      reason: 'config_company_scope',
    });
  }
  const s = schema.shifts;
  const shifts = await ctx.tx
    .select({ id: s.id, name: s.name })
    .from(s)
    .where(and(isNull(s.archivedAt), or(isNull(s.entityId), eq(s.entityId, input.entityId))))
    .orderBy(asc(s.name));
  const e = schema.employees;
  const managers = await ctx.tx
    .select({ id: e.id, name: e.name })
    .from(e)
    .where(and(eq(e.entityId, input.entityId), eq(e.active, true)))
    .orderBy(sql`lower(${e.name})`, asc(e.id));
  // Other people's users rows are an admin's to read, so names come from `principals`. Everyone
  // holding a role in the company is offered, as the command accepts them; a person whose roles
  // were taken away holds none.
  const uer = schema.userEntityRoles;
  const p = schema.principals;
  const people = await ctx.tx
    .selectDistinct({ id: p.id, name: p.displayName })
    .from(uer)
    .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
    .where(
      and(
        eq(uer.entityId, input.entityId),
        sql`not exists (select 1 from employees x
                         where x.user_id = ${uer.userId} and x.entity_id = ${input.entityId})`,
      ),
    )
    .orderBy(asc(p.displayName), asc(p.id));
  return HrChoicesDto.parse({ shifts, managers, people });
}

/**
 * HR › Leave: the caller's own records, the leave types offered to them, their balances and
 * requests; and, to a holder of `hr.leave.approve`, the waiting requests of the people they may
 * decide for (never their own), oldest first, each with the person's balance of its type.
 */
export async function getLeaveScreen(ctx: QueryContext): Promise<LeaveScreenDto> {
  const e = schema.employees;
  const r = schema.leaveRequests;
  const own = await ctx.tx
    .select({ id: e.id, entityId: e.entityId, name: e.name, active: e.active })
    .from(e)
    .where(eq(e.userId, ctx.principal.id))
    .orderBy(asc(e.entityId));
  const ownIds = own.map((o) => o.id);
  const entities = [...new Set(own.filter((o) => o.active).map((o) => o.entityId))];
  const t = schema.leaveTypes;
  const leaveTypes =
    entities.length === 0
      ? []
      : await ctx.tx
          .select({ id: t.id, entityId: t.entityId, name: t.name })
          .from(t)
          .where(and(isNull(t.archivedAt), or(isNull(t.entityId), inArray(t.entityId, entities))))
          .orderBy(asc(t.name));
  const balances = await balancesOf(ctx.tx, ownIds);
  const requests =
    ownIds.length === 0
      ? []
      : await requestRows(ctx.tx, and(inArray(r.employeeId, ownIds)), 'newest', LEAVE_SCREEN_ROWS);
  const decides = hasGrant(ctx.principal.permissions, 'hr.leave.approve', 'team');
  const waiting = decides
    ? await requestRows(
        ctx.tx,
        and(eq(r.state, 'requested'), sql`${e.userId} is distinct from ${ctx.principal.id}::uuid`),
        'oldestWaiting',
        LEAVE_SCREEN_ROWS,
      )
    : [];
  const waitingBalances = await balancesOf(ctx.tx, [...new Set(waiting.map((w) => w.employeeId))]);
  return LeaveScreenDto.parse({
    own: own.filter((o) => o.active).map((o) => ({ id: o.id, entityId: o.entityId, name: o.name })),
    leaveTypes,
    balances,
    requests,
    toDecide: waiting.map((w) => ({
      ...w,
      balance:
        waitingBalances.find(
          (b) => b.employeeId === w.employeeId && b.leaveTypeId === w.leaveTypeId,
        )?.days ?? 0,
    })),
  });
}

/** HR › Shifts: the company's and the group's shifts, by name; archived ones when asked. */
export async function listShifts(ctx: QueryContext, rawInput: unknown): Promise<ShiftListDto> {
  const input = parseQueryInput(ListShiftsInput, rawInput, 'hr.shifts.list');
  const s = schema.shifts;
  const rows = await ctx.tx
    .select()
    .from(s)
    .where(input.includeArchived ? undefined : isNull(s.archivedAt))
    .orderBy(asc(s.name), asc(s.id));
  return ShiftListDto.parse({ shifts: rows.map(toShiftDto) });
}

/** HR › Leave types: the company's and the group's, by name; archived ones when asked. */
export async function listLeaveTypes(
  ctx: QueryContext,
  rawInput: unknown,
): Promise<LeaveTypeListDto> {
  const input = parseQueryInput(ListLeaveTypesInput, rawInput, 'hr.leaveTypes.list');
  const t = schema.leaveTypes;
  const rows = await ctx.tx
    .select()
    .from(t)
    .where(input.includeArchived ? undefined : isNull(t.archivedAt))
    .orderBy(asc(t.name), asc(t.id));
  return LeaveTypeListDto.parse({ leaveTypes: rows.map(toLeaveTypeDto) });
}

/** HR › Holidays: the holidays of one year, of the request's companies and of the group, by day. */
export async function listHolidays(ctx: QueryContext, rawInput: unknown): Promise<HolidayListDto> {
  const input = parseQueryInput(ListHolidaysInput, rawInput, 'hr.holidays.list');
  const h = schema.holidays;
  const rows = await ctx.tx
    .select()
    .from(h)
    .where(
      sql`${h.onDate} between ${`${String(input.year)}-01-01`} and ${`${String(input.year)}-12-31`}`,
    )
    .orderBy(asc(h.onDate), sql`${h.entityId} nulls first`);
  return HolidayListDto.parse({
    holidays: rows.map((row) => ({
      id: row.id,
      entityId: row.entityId,
      date: row.onDate,
      name: row.name,
    })),
  });
}
