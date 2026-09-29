import {
  ArchiveItemInput,
  CreateItemInput,
  DomainError,
  ItemDetailDto,
  ItemDto,
  newId,
  UpdateItemInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { eventEntity } from './shared';
import { toItemDto } from '../../queries/catalogue/item-dto';
import { readItemDetail } from '../../queries/catalogue/item-detail';

/** Every field an item's audit rows may carry. */
const ITEM_AUDIT_FIELDS = [
  'sku',
  'itemName',
  'category',
  'hsn',
  'unit',
  'isSerialTracked',
  'isDcr',
  'almmRef',
  'specs',
  'isActive',
] as const;

type ItemRow = typeof schema.items.$inferSelect;

/** The audited form of an item: what a person edits, never an id or a date. */
function auditedItem(row: ItemRow) {
  return {
    sku: row.sku,
    itemName: row.name,
    category: row.category,
    hsn: row.hsn,
    unit: row.unit,
    isSerialTracked: row.isSerialTracked,
    isDcr: row.isDcr,
    almmRef: row.almmRef,
    specs: row.specsJson,
    isActive: row.isActive,
  };
}

/** An item that is still in the catalogue, locked for the change, or `catalogue_item_missing`. */
async function lockLiveItem(ctx: CommandContext, itemId: string): Promise<ItemRow> {
  const [row] = await ctx.tx
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), isNull(schema.items.archivedAt)))
    .limit(1)
    .for('update');
  if (!row) {
    throw new DomainError('not_found', `item ${itemId} is not in the catalogue`, {
      reason: 'catalogue_item_missing',
    });
  }
  return row;
}

/**
 * `catalogue.item.create` (INV-01): an item of the one catalogue every company sells from, with
 * the specifications of its category. A code already in use answers `item_sku_taken`.
 */
export const createItem = defineCommand({
  name: 'catalogue.item.create',
  permission: 'catalogue.write',
  minScope: 'entity',
  input: CreateItemInput,
  output: ItemDetailDto,
  auditFields: ITEM_AUDIT_FIELDS,
  constraintReasons: { items_sku_unique: 'item_sku_taken' },
  async handler(ctx, input) {
    const [row] = await ctx.tx
      .insert(schema.items)
      .values({
        id: newId(),
        sku: input.sku,
        name: input.name,
        category: input.category,
        hsn: input.hsn,
        unit: input.unit,
        isSerialTracked: input.isSerialTracked,
        isDcr: input.isDcr,
        almmRef: input.almmRef ?? null,
        specsJson: input.specs,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'item insert returned no row');
    ctx.audit({
      aggregateType: 'item',
      aggregateId: row.id,
      entityId: null,
      before: null,
      after: auditedItem(row),
    });
    ctx.emit({
      type: 'catalogue.item.created',
      entityId: eventEntity(ctx),
      aggregateType: 'item',
      aggregateId: row.id,
      payload: { category: input.category },
    });
    return readItemDetail(ctx.tx, row.id);
  },
});

/**
 * `catalogue.item.update`: every editable field of an item still in the catalogue. Quotes already
 * made keep what they recorded. A pump that becomes another category keeps no curve.
 */
export const updateItem = defineCommand({
  name: 'catalogue.item.update',
  permission: 'catalogue.write',
  minScope: 'entity',
  input: UpdateItemInput,
  output: ItemDetailDto,
  auditFields: ITEM_AUDIT_FIELDS,
  constraintReasons: { items_sku_unique: 'item_sku_taken' },
  async handler(ctx, input) {
    const before = await lockLiveItem(ctx, input.itemId);
    const [row] = await ctx.tx
      .update(schema.items)
      .set({
        sku: input.sku,
        name: input.name,
        category: input.category,
        hsn: input.hsn,
        unit: input.unit,
        isSerialTracked: input.isSerialTracked,
        isDcr: input.isDcr,
        almmRef: input.almmRef ?? null,
        specsJson: input.specs,
        updatedBy: ctx.principal.id,
      })
      .where(eq(schema.items.id, input.itemId))
      .returning();
    if (!row) throw new DomainError('internal', 'item update returned no row');
    if (before.category === 'pump' && row.category !== 'pump') {
      await ctx.tx.delete(schema.pumpCurves).where(eq(schema.pumpCurves.itemId, row.id));
    }
    ctx.audit({
      aggregateType: 'item',
      aggregateId: row.id,
      entityId: null,
      before: auditedItem(before),
      after: auditedItem(row),
    });
    ctx.emit({
      type: 'catalogue.item.updated',
      entityId: eventEntity(ctx),
      aggregateType: 'item',
      aggregateId: row.id,
      payload: { category: input.category },
    });
    return readItemDetail(ctx.tx, row.id);
  },
});

/**
 * `catalogue.item.archive`: the item leaves the catalogue and can no longer be priced, put in a
 * kit or quoted. An item inside a kit still sold answers `item_in_kit`: the kit changes first.
 */
export const archiveItem = defineCommand({
  name: 'catalogue.item.archive',
  permission: 'catalogue.write',
  minScope: 'entity',
  input: ArchiveItemInput,
  output: ItemDto,
  auditFields: ['isActive'],
  async handler(ctx, input) {
    const before = await lockLiveItem(ctx, input.itemId);
    const [inKit] = await ctx.tx
      .select({ id: schema.kits.id })
      .from(schema.kitComponents)
      .innerJoin(schema.kits, eq(schema.kits.id, schema.kitComponents.kitId))
      .where(and(eq(schema.kitComponents.itemId, input.itemId), isNull(schema.kits.archivedAt)))
      .limit(1);
    if (inKit) {
      throw new DomainError('conflict', 'item is part of a kit still sold', {
        reason: 'item_in_kit',
      });
    }
    const [row] = await ctx.tx
      .update(schema.items)
      .set({ isActive: false, archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(eq(schema.items.id, input.itemId))
      .returning();
    if (!row) throw new DomainError('internal', 'item archive returned no row');
    ctx.audit({
      aggregateType: 'item',
      aggregateId: row.id,
      entityId: null,
      before: { isActive: before.isActive },
      after: { isActive: false },
    });
    ctx.emit({
      type: 'catalogue.item.archived',
      entityId: eventEntity(ctx),
      aggregateType: 'item',
      aggregateId: row.id,
      payload: { category: row.category as ItemDto['category'] },
    });
    return toItemDto(row);
  },
});
