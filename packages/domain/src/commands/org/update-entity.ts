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
