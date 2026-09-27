import { DomainError, EntityDto, UpdateEntityInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { toEntityDto } from '../../queries/org/entity-dto';

/**
 * `org.entity.update`: an Executive changes the brand name or UPI id of an entity in scope.
 * RLS hides entities outside the request scope, so an update there affects no row and the
 * command answers `not_found` rather than confirming the entity exists.
 */
export const updateEntity = defineCommand({
  name: 'org.entity.update',
  permission: 'admin.entities.write',
  minScope: 'all',
  input: UpdateEntityInput,
  output: EntityDto,
  async handler(ctx, input) {
    const patch: Partial<typeof schema.entities.$inferInsert> = {};
    if (input.brandName !== undefined) patch.brandName = input.brandName;
    if (input.upiId !== undefined) patch.upiId = input.upiId;
    if (Object.keys(patch).length === 0) {
      throw new DomainError('validation_failed', 'nothing to update', { entityId: input.entityId });
    }

    const e = schema.entities;
    const [before] = await ctx.tx
      .select({ brandName: e.brandName, upiId: e.upiId })
      .from(e)
      .where(eq(e.id, input.entityId))
      .limit(1)
      .for('update');
    const [row] = await ctx.tx
      .update(schema.entities)
      .set({ ...patch, updatedBy: ctx.principal.id })
      .where(eq(schema.entities.id, input.entityId))
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
      before: before === undefined ? null : pick(before, Object.keys(patch)),
      after: pick(row, Object.keys(patch)),
    });
    ctx.emit({
      type: 'org.entity.updated',
      entityId: row.id,
      aggregateType: 'entity',
      aggregateId: String(row.id),
      payload: { fields: Object.keys(patch) },
    });
    return toEntityDto(row);
  },
});

/** The changed fields only, so the audit row shows what this call touched. */
function pick(source: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k] ?? null]));
}
