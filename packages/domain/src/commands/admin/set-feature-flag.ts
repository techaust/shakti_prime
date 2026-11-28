import { DomainError, FeatureFlagDto, newId, SetFeatureFlagInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

/**
 * `admin.flag.set` (docs/03-roadmap-appendix/phase4.md §6.4): switches a feature on or off for the
 * group (`entityId` null) or for one company of the request, whose row then wins for that company.
 * A row is switched, never deleted, so the audit trail keeps every change.
 */
export const setFeatureFlag = defineCommand({
  name: 'admin.flag.set',
  permission: 'admin.flags.write',
  minScope: 'all',
  peopleOnly: true,
  input: SetFeatureFlagInput,
  output: FeatureFlagDto,
  auditFields: ['enabled'],
  async handler(ctx, input) {
    if (input.entityId !== null && !ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'the company is outside the request', {
        entityId: input.entityId,
      });
    }
    const f = schema.featureFlags;
    const where = and(
      eq(f.key, input.key),
      input.entityId === null ? isNull(f.entityId) : eq(f.entityId, input.entityId),
    );
    const [before] = await ctx.tx
      .select({ id: f.id, enabled: f.enabled })
      .from(f)
      .where(where)
      .limit(1)
      .for('update');
    const [row] =
      before === undefined
        ? await ctx.tx
            .insert(f)
            .values({
              id: newId(),
              key: input.key,
              entityId: input.entityId,
              enabled: input.enabled,
              createdBy: ctx.principal.id,
              updatedBy: ctx.principal.id,
            })
            .returning()
        : await ctx.tx
            .update(f)
            .set({ enabled: input.enabled, updatedBy: ctx.principal.id })
            .where(eq(f.id, before.id))
            .returning();
    if (!row) throw new DomainError('internal', 'feature flag write returned no row');
    ctx.audit({
      aggregateType: 'feature_flag',
      aggregateId: row.id,
      entityId: row.entityId,
      before: before === undefined ? null : { enabled: before.enabled },
      after: { enabled: row.enabled },
    });
    return {
      id: row.id,
      key: row.key,
      entityId: row.entityId,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
    };
  },
});
