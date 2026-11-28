import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { CalendarDateSchema } from '../tax/engine';
import { LeaveMovementDto, LeaveRequestDto } from './leave';
import { EmployeeDto, HolidayDto, LeaveTypeDto, ShiftDto } from './people';

// HR1's reads (docs/03-roadmap-appendix/phase5.md §5): the directory, a person's page, the leave
// screen and HR's settings. Row security decides every row; these shapes only carry them.

/** HR › People: by name, a page at a time; people who left only when asked for. */
export const ListEmployeesInput = z
  .object({
    cursor: z.string().max(1024).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    /** Part of the name. */
    q: z.string().trim().min(1).max(80).optional(),
    includeLeft: z.boolean().default(false),
  })
  .strict();
export type ListEmployeesInput = z.input<typeof ListEmployeesInput>;

/** One person of the directory. */
export const EmployeeRowDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    name: z.string(),
    office: z.string().nullable(),
    joinedOn: CalendarDateSchema,
    active: z.boolean(),
    managerName: z.string().nullable(),
    shiftName: z.string().nullable(),
    /** The person signs in to the BOS. */
    signsIn: z.boolean(),
  })
  .strict();
export type EmployeeRowDto = z.infer<typeof EmployeeRowDto>;

export const EmployeePageDto = z
  .object({ items: z.array(EmployeeRowDto), nextCursor: z.string().nullable() })
  .strict();
export type EmployeePageDto = z.infer<typeof EmployeePageDto>;

/** A person's balance of one leave type: the sum of its movements. */
export const LeaveBalanceDto = z
  .object({ leaveTypeId: IdSchema, leaveTypeName: z.string(), days: z.number() })
  .strict();
export type LeaveBalanceDto = z.infer<typeof LeaveBalanceDto>;

/** A leave request with the names a list shows. */
export const LeaveRequestRowDto = LeaveRequestDto.extend({
  employeeName: z.string(),
  leaveTypeName: z.string(),
}).strict();
export type LeaveRequestRowDto = z.infer<typeof LeaveRequestRowDto>;

/** A movement of a balance with its leave type's name. */
export const LeaveMovementRowDto = LeaveMovementDto.extend({ leaveTypeName: z.string() }).strict();
export type LeaveMovementRowDto = z.infer<typeof LeaveMovementRowDto>;

/** The newest requests and movements a person's page lists. */
export const EMPLOYEE_SHEET_ROWS = 50;

export const GetEmployeeInput = z.object({ id: IdSchema }).strict();
export type GetEmployeeInput = z.input<typeof GetEmployeeInput>;

/** A person's page: the record, their manager and shift, balances, requests and movements. */
export const EmployeeSheetDto = z
  .object({
    /** `phone` is null unless `phoneShown`: only HR (`hr.employee.write`) reads the number. */
    employee: EmployeeDto,
    phoneShown: z.boolean(),
    managerName: z.string().nullable(),
    shift: ShiftDto.nullable(),
    balances: z.array(LeaveBalanceDto),
    requests: z.array(LeaveRequestRowDto),
    movements: z.array(LeaveMovementRowDto),
  })
  .strict();
export type EmployeeSheetDto = z.infer<typeof EmployeeSheetDto>;

/** A name to choose in a form. */
export const NamedChoiceDto = z.object({ id: IdSchema, name: z.string() }).strict();
export type NamedChoiceDto = z.infer<typeof NamedChoiceDto>;

/** What HR's employee form offers for one company. */
export const HrChoicesInput = z.object({ entityId: EntityIdSchema }).strict();
export type HrChoicesInput = z.input<typeof HrChoicesInput>;

export const HrChoicesDto = z
  .object({
    /** Shifts in use, of the company and of the group. */
    shifts: z.array(NamedChoiceDto),
    /** People on the company's staff, who may be someone's manager. */
    managers: z.array(NamedChoiceDto),
    /** People with a role in the company and no staff record there yet, by their sign-in. */
    people: z.array(NamedChoiceDto),
  })
  .strict();
export type HrChoicesDto = z.infer<typeof HrChoicesDto>;

/** A leave type a request may name, with its company (null for the group). */
export const LeaveTypeChoiceDto = z
  .object({ id: IdSchema, entityId: EntityIdSchema.nullable(), name: z.string() })
  .strict();
export type LeaveTypeChoiceDto = z.infer<typeof LeaveTypeChoiceDto>;

/** The caller's own staff record in a company, for asking for leave. */
export const OwnEmployeeDto = z
  .object({ id: IdSchema, entityId: EntityIdSchema, name: z.string() })
  .strict();
export type OwnEmployeeDto = z.infer<typeof OwnEmployeeDto>;

/** A waiting request an approver may decide, with the person's balance of its type. */
export const LeaveToDecideDto = LeaveRequestRowDto.extend({ balance: z.number() }).strict();
export type LeaveToDecideDto = z.infer<typeof LeaveToDecideDto>;

/** The most requests each list of the leave screen shows. */
export const LEAVE_SCREEN_ROWS = 100;

/** HR › Leave: the caller's own leave and, for an approver, what waits for them. */
export const LeaveScreenDto = z
  .object({
    own: z.array(OwnEmployeeDto),
    leaveTypes: z.array(LeaveTypeChoiceDto),
    balances: z.array(LeaveBalanceDto.extend({ employeeId: IdSchema }).strict()),
    requests: z.array(LeaveRequestRowDto),
    toDecide: z.array(LeaveToDecideDto),
  })
  .strict();
export type LeaveScreenDto = z.infer<typeof LeaveScreenDto>;

export const ListShiftsInput = z.object({ includeArchived: z.boolean().default(false) }).strict();
export type ListShiftsInput = z.input<typeof ListShiftsInput>;
export const ShiftListDto = z.object({ shifts: z.array(ShiftDto) }).strict();
export type ShiftListDto = z.infer<typeof ShiftListDto>;

export const ListLeaveTypesInput = z
  .object({ includeArchived: z.boolean().default(false) })
  .strict();
export type ListLeaveTypesInput = z.input<typeof ListLeaveTypesInput>;
export const LeaveTypeListDto = z.object({ leaveTypes: z.array(LeaveTypeDto) }).strict();
export type LeaveTypeListDto = z.infer<typeof LeaveTypeListDto>;

/** The holidays of one calendar year. */
export const ListHolidaysInput = z.object({ year: z.number().int().min(2000).max(2100) }).strict();
export type ListHolidaysInput = z.input<typeof ListHolidaysInput>;
export const HolidayListDto = z.object({ holidays: z.array(HolidayDto) }).strict();
export type HolidayListDto = z.infer<typeof HolidayListDto>;
