import { DomainError, ItemDetailDto, newId, SetPumpCurveInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readItemDetail, readPumpCurve } from '../../queries/catalogue/item-detail';
import { assertCatalogueGroupScope, eventEntity } from './shared';

/**
 * `catalogue.pump_curve.set` (SAL-04): a pump's curve as a set of points, replacing the one
 * before. The item must be a pump still in the catalogue (`pump_curve_not_pump`).
 */
export const setPumpCurve = defineCommand({
  name: 'catalogue.pump_curve.set',
  permission: 'catalogue.write',
  minScope: 'entity',
  input: SetPumpCurveInput,
  output: ItemDetailDto,
  auditFields: ['points'],
  async handler(ctx, input) {
    await assertCatalogueGroupScope(ctx);
    const [item] = await ctx.tx
      .select({ id: schema.items.id, category: schema.items.category })
      .from(schema.items)
      .where(and(eq(schema.items.id, input.itemId), isNull(schema.items.archivedAt)))
      .limit(1)
      // two saves of one curve take turns, so the second replaces the first whole
      .for('update');
    if (!item) {
      throw new DomainError('not_found', `item ${input.itemId} is not in the catalogue`, {
        reason: 'catalogue_item_missing',
      });
    }
    if (item.category !== 'pump') {
      throw new DomainError('validation_failed', 'only a pump has a curve', {
        reason: 'pump_curve_not_pump',
      });
    }
    const before = await readPumpCurve(ctx.tx, item.id);
    const pc = schema.pumpCurves;
    await ctx.tx.delete(pc).where(eq(pc.itemId, item.id));
    await ctx.tx.insert(pc).values(
      input.points.map((p) => ({
        id: newId(),
        itemId: item.id,
        flowLph: p.flowLph,
        headM: p.headM,
        createdBy: ctx.principal.id,
      })),
    );
    ctx.audit({
      aggregateType: 'item',
      aggregateId: item.id,
      entityId: null,
      before: { points: before.map((p) => [p.flowLph, p.headM]) },
      after: { points: input.points.map((p) => [p.flowLph, p.headM]) },
    });
    ctx.emit({
      type: 'catalogue.pump_curve.set',
      entityId: eventEntity(ctx),
      aggregateType: 'item',
      aggregateId: item.id,
      payload: { points: input.points.length },
    });
    return readItemDetail(ctx.tx, item.id);
  },
});
