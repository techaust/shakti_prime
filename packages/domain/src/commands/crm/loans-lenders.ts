import {
  CreateLenderInput,
  DomainError,
  LenderDto,
  newId,
  UpdateLenderInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';

/**
 * A company's lenders (docs/03-roadmap-appendix/phase4.md §6.2), kept by the Executive in
 * Settings › Lenders: added, renamed, switched off and on again, never removed, since loans name
 * them. The list starts empty until the client names its lenders (§12 question 6).
 */

const LENDER_AUDIT_FIELDS = ['name', 'isActive'] as const;

function assertCompany(ctx: CommandContext, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/** `crm.lender.create`: a lender added to a company's list. */
export const createLender = defineCommand({
  name: 'crm.lender.create',
  permission: 'admin.entities.write',
  minScope: 'all',
  peopleOnly: true,
  input: CreateLenderInput,
  output: LenderDto,
  auditFields: LENDER_AUDIT_FIELDS,
  constraintReasons: { lenders_entity_name_unique: 'lender_name_taken' },
  async handler(ctx, input) {
    assertCompany(ctx, input.entityId);
    const id = newId();
    const [row] = await ctx.tx
      .insert(schema.lenders)
      .values({ id, entityId: input.entityId, name: input.name, createdBy: ctx.principal.id })
      .returning();
    if (!row) throw new DomainError('internal', 'lender insert returned no row');
    ctx.audit({
      aggregateType: 'lender',
      aggregateId: row.id,
      entityId: row.entityId,
      after: { name: row.name, isActive: row.isActive },
    });
    return { id: row.id, entityId: row.entityId, name: row.name, isActive: row.isActive };
  },
});

/** `crm.lender.update`: a lender renamed, switched off, or switched on again. */
export const updateLender = defineCommand({
  name: 'crm.lender.update',
  permission: 'admin.entities.write',
  minScope: 'all',
  peopleOnly: true,
  input: UpdateLenderInput,
  output: LenderDto,
  auditFields: LENDER_AUDIT_FIELDS,
  constraintReasons: { lenders_entity_name_unique: 'lender_name_taken' },
  async handler(ctx, input) {
    assertCompany(ctx, input.entityId);
    const l = schema.lenders;
    const [before] = await ctx.tx
      .select()
      .from(l)
      .where(and(eq(l.id, input.lenderId), eq(l.entityId, input.entityId)))
      .for('update')
      .limit(1);
    if (!before) {
      throw new DomainError('not_found', `lender ${input.lenderId} is not visible`, {
        reason: 'lender_missing',
      });
    }
    const [row] = await ctx.tx
      .update(l)
      .set({
        name: input.name ?? before.name,
        isActive: input.isActive ?? before.isActive,
        updatedBy: ctx.principal.id,
      })
      .where(eq(l.id, before.id))
      .returning();
    if (!row)
      throw new DomainError('forbidden', `lender ${before.id} is outside the caller's scope`);
    ctx.audit({
      aggregateType: 'lender',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { name: before.name, isActive: before.isActive },
      after: { name: row.name, isActive: row.isActive },
    });
    return { id: row.id, entityId: row.entityId, name: row.name, isActive: row.isActive };
  },
});
