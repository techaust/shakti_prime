import { DomainError, EntityDto, UpdateEntityInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { toEntityDto } from '../../queries/org/entity-dto';

/** The fields the command may change, in the order the audit row and the event list them. */
const EDITABLE = [
  'brandName',
  'upiId',
  'gstin',
  'stateCode',
  'addressLine1',
  'addressLine2',
  'city',
  'pin',
] as const;

/**
 * `org.entity.update`: an Executive changes the brand name, UPI id, GSTIN or registered address
 * of an entity in scope (workshop pack SALE-2). The GSTIN must start with the company's GST state
 * code, checked against the stored value of whichever of the two this call leaves alone. RLS hides
 * entities outside the request scope, so the command answers `not_found` there rather than
 * confirming the entity exists.
 */
export const updateEntity = defineCommand({
  name: 'org.entity.update',
  permission: 'admin.entities.write',
  minScope: 'all',
  input: UpdateEntityInput,
  output: EntityDto,
  auditFields: EDITABLE,
  async handler(ctx, input) {
    const patch: Partial<Pick<typeof schema.entities.$inferInsert, (typeof EDITABLE)[number]>> = {};
    for (const field of EDITABLE) {
      const value = input[field];
      if (value !== undefined) Object.assign(patch, { [field]: value });
    }
    const fields = EDITABLE.filter((f) => f in patch);
    if (fields.length === 0) {
      throw new DomainError('validation_failed', 'nothing to update', { entityId: input.entityId });
    }

    const e = schema.entities;
    const [before] = await ctx.tx
      .select()
      .from(e)
      .where(eq(e.id, input.entityId))
      .limit(1)
      .for('update');
    if (!before) {
      throw new DomainError('not_found', 'entity not visible in this scope', {
        entityId: input.entityId,
      });
    }
    const gstin = patch.gstin === undefined ? before.gstin : patch.gstin;
    const stateCode = patch.stateCode ?? before.stateCode;
    if (gstin !== null && !gstin.startsWith(stateCode)) {
      throw new DomainError('validation_failed', 'the GSTIN is of another state', {
        reason: 'gstin_state_mismatch',
        issues: [{ path: patch.gstin === undefined ? 'stateCode' : 'gstin', message: 'state' }],
      });
    }

    const [row] = await ctx.tx
      .update(e)
      .set({ ...patch, updatedBy: ctx.principal.id })
      .where(eq(e.id, input.entityId))
      .returning();
    if (!row) {
      throw new DomainError('not_found', 'entity not visible in this scope', {
        entityId: input.entityId,
      });
    }

    ctx.audit({
      aggregateType: 'entity',
      aggregateId: String(row.id),
      entityId: row.id,
      before: pick(before, fields),
      after: pick(row, fields),
    });
    ctx.emit({
      type: 'org.entity.updated',
      entityId: row.id,
      aggregateType: 'entity',
      aggregateId: String(row.id),
      payload: { fields },
    });
    return toEntityDto(row);
  },
});

/** The changed fields only, so the audit row shows what this call touched. */
function pick(source: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k] ?? null]));
}
