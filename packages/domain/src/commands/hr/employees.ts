import {
  CreateEmployeeInput,
  DeactivateEmployeeInput,
  DomainError,
  EmployeeDto,
  newId,
  UpdateEmployeeInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { type EmployeeRow, toEmployeeDto } from '../../hr/rows';

/**
 * The employee directory (docs/03-roadmap-appendix/phase5.md §5, PRD HR-01): HR (and the
 * Executive) keep one record per person and company, with or without a sign-in. People only;
 * the phone never reaches the audit trail, only whether one is on record.
 */

/** Every field an employee's audit rows may carry. */
const EMPLOYEE_AUDIT_FIELDS = [
  'employeeName',
  'phoneOnRecord',
  'office',
  'joinedOn',
  'active',
  'leftOn',
] as const;

function audited(row: EmployeeRow) {
  return {
    employeeName: row.name,
    phoneOnRecord: row.phone !== null,
    managerId: row.managerId,
    shiftId: row.shiftId,
    userId: row.userId,
    office: row.office,
    joinedOn: row.joinedOn,
    active: row.active,
    leftOn: row.leftOn,
  };
}

/**
 * Serialises the manager changes of one company for the rest of the transaction, so two people
 * setting each other's manager at once cannot both pass the loop check (review finding 6).
 */
async function lockManagerChain(ctx: CommandContext, entityId: number): Promise<void> {
  await ctx.tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`hr.employee.manager:${String(entityId)}`}, 0))`,
  );
}

/**
 * What the audit row keeps of an employee's input: whether a phone was given, never its digits
 * (the brief's "no phone digits in values").
 */
function auditedInput<I extends { phone: string | null }>({ phone, ...rest }: I) {
  return { ...rest, phoneOnRecord: phone !== null };
}

/** The employee, locked for a change, or `employee_missing`. */
async function lockEmployee(ctx: CommandContext, id: string): Promise<EmployeeRow> {
  const [row] = await ctx.tx
    .select()
    .from(schema.employees)
    .where(eq(schema.employees.id, id))
    .limit(1)
    .for('update');
  if (!row) {
    throw new DomainError('not_found', `employee ${id} is not readable`, {
      reason: 'employee_missing',
    });
  }
  return row;
}

/** A sign-in may be linked only to a person holding a role in the company. */
async function checkSignIn(ctx: CommandContext, userId: string, entityId: number): Promise<void> {
  const uer = schema.userEntityRoles;
  const [role] = await ctx.tx
    .select({ id: uer.id })
    .from(uer)
    .where(and(eq(uer.userId, userId), eq(uer.entityId, entityId)))
    .limit(1);
  if (!role) {
    throw new DomainError('validation_failed', 'the person has no role in the company', {
      reason: 'employee_user_not_in_company',
    });
  }
}

/** A shift of the company or of the group, in use. */
async function checkShift(ctx: CommandContext, shiftId: string, entityId: number): Promise<void> {
  const s = schema.shifts;
  const [shift] = await ctx.tx
    .select({ id: s.id })
    .from(s)
    .where(
      and(
        eq(s.id, shiftId),
        isNull(s.archivedAt),
        or(isNull(s.entityId), eq(s.entityId, entityId)),
      ),
    )
    .limit(1);
  if (!shift) {
    throw new DomainError('validation_failed', `shift ${shiftId} is not one of the company's`, {
      reason: 'employee_shift_missing',
    });
  }
}

/**
 * A manager on the staff of the same company, in post, who is not the person themselves and does
 * not report to them, however far up.
 */
async function checkManager(
  ctx: CommandContext,
  managerId: string,
  entityId: number,
  employeeId: string,
): Promise<void> {
  const e = schema.employees;
  const seen = new Set<string>([employeeId]);
  let next: string | null = managerId;
  let first = true;
  while (next !== null) {
    if (seen.has(next)) {
      throw new DomainError('validation_failed', 'the manager reports to the person', {
        reason: 'employee_manager_cycle',
      });
    }
    seen.add(next);
    const [row] = await ctx.tx
      .select({ managerId: e.managerId, entityId: e.entityId, active: e.active })
      .from(e)
      .where(eq(e.id, next))
      .limit(1);
    if (first && !(row?.entityId === entityId && row.active)) {
      throw new DomainError('validation_failed', `manager ${managerId} is not on the staff`, {
        reason: 'employee_manager_missing',
      });
    }
    first = false;
    next = row?.managerId ?? null;
  }
}

/** `hr.employee.create`: a person on the staff of one company. */
export const createEmployee = defineCommand({
  name: 'hr.employee.create',
  permission: 'hr.employee.write',
  minScope: 'all',
  peopleOnly: true,
  input: CreateEmployeeInput,
  output: EmployeeDto,
  auditFields: EMPLOYEE_AUDIT_FIELDS,
  auditInput: auditedInput,
  constraintReasons: { employees_user_entity_unique: 'employee_user_taken' },
  async handler(ctx, input) {
    if (!ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'company outside the request scope', {
        reason: 'config_company_scope',
      });
    }
    const id = newId();
    if (input.userId !== null) await checkSignIn(ctx, input.userId, input.entityId);
    if (input.shiftId !== null) await checkShift(ctx, input.shiftId, input.entityId);
    if (input.managerId !== null) {
      await lockManagerChain(ctx, input.entityId);
      await checkManager(ctx, input.managerId, input.entityId, id);
    }
    const [row] = await ctx.tx
      .insert(schema.employees)
      .values({
        id,
        entityId: input.entityId,
        userId: input.userId,
        name: input.name,
        phone: input.phone,
        managerId: input.managerId,
        shiftId: input.shiftId,
        office: input.office,
        joinedOn: input.joinedOn,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'employee insert returned no row');
    ctx.audit({
      aggregateType: 'employee',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: audited(row),
    });
    return toEmployeeDto(row);
  },
});

/** `hr.employee.update`: every field HR keeps, of a person still on the staff. */
export const updateEmployee = defineCommand({
  name: 'hr.employee.update',
  permission: 'hr.employee.write',
  minScope: 'all',
  peopleOnly: true,
  input: UpdateEmployeeInput,
  output: EmployeeDto,
  auditFields: EMPLOYEE_AUDIT_FIELDS,
  auditInput: auditedInput,
  constraintReasons: { employees_user_entity_unique: 'employee_user_taken' },
  async handler(ctx, input) {
    const before = await lockEmployee(ctx, input.id);
    if (!before.active) {
      throw new DomainError('conflict', `employee ${input.id} has left`, {
        reason: 'employee_inactive',
      });
    }
    // Unlinking one's own sign-in would make one's own leave look like that of staff with no
    // sign-in, which one could then approve oneself (review finding 4).
    if (input.userId !== before.userId && before.userId === ctx.principal.id) {
      throw new DomainError(
        'forbidden',
        'a person does not change the sign-in of their own record',
        {
          reason: 'employee_own_sign_in',
        },
      );
    }
    if (input.userId !== null && input.userId !== before.userId) {
      await checkSignIn(ctx, input.userId, before.entityId);
    }
    if (input.shiftId !== null && input.shiftId !== before.shiftId) {
      await checkShift(ctx, input.shiftId, before.entityId);
    }
    // A manager kept as it was is not checked again: one who has since left stays until HR
    // chooses another (review finding 1).
    if (input.managerId !== null && input.managerId !== before.managerId) {
      await lockManagerChain(ctx, before.entityId);
      await checkManager(ctx, input.managerId, before.entityId, before.id);
    }
    const [row] = await ctx.tx
      .update(schema.employees)
      .set({
        userId: input.userId,
        name: input.name,
        phone: input.phone,
        managerId: input.managerId,
        shiftId: input.shiftId,
        office: input.office,
        joinedOn: input.joinedOn,
        updatedBy: ctx.principal.id,
      })
      .where(eq(schema.employees.id, before.id))
      .returning();
    if (!row) throw new DomainError('internal', 'employee update returned no row');
    ctx.audit({
      aggregateType: 'employee',
      aggregateId: row.id,
      entityId: row.entityId,
      before: audited(before),
      after: audited(row),
    });
    return toEmployeeDto(row);
  },
});

/** `hr.employee.deactivate`: the person left on a day; their record and leave history stay. */
export const deactivateEmployee = defineCommand({
  name: 'hr.employee.deactivate',
  permission: 'hr.employee.write',
  minScope: 'all',
  peopleOnly: true,
  input: DeactivateEmployeeInput,
  output: EmployeeDto,
  auditFields: EMPLOYEE_AUDIT_FIELDS,
  async handler(ctx, input) {
    const before = await lockEmployee(ctx, input.id);
    if (!before.active) {
      throw new DomainError('conflict', `employee ${input.id} has already left`, {
        reason: 'employee_inactive',
      });
    }
    if (input.leftOn < before.joinedOn) {
      throw new DomainError('validation_failed', 'left before joining', {
        reason: 'employee_left_before_joining',
      });
    }
    const [row] = await ctx.tx
      .update(schema.employees)
      .set({ active: false, leftOn: input.leftOn, updatedBy: ctx.principal.id })
      .where(eq(schema.employees.id, before.id))
      .returning();
    if (!row) throw new DomainError('internal', 'employee update returned no row');
    ctx.audit({
      aggregateType: 'employee',
      aggregateId: row.id,
      entityId: row.entityId,
      before: audited(before),
      after: audited(row),
    });
    return toEmployeeDto(row);
  },
});
