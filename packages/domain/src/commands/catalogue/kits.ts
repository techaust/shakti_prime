import {
  ArchiveKitInput,
  CreateKitInput,
  DomainError,
  KitDetailDto,
  newId,
  UpdateKitInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { readKitDetail } from '../../queries/catalogue/item-detail';
import { eventEntity } from './shared';

type Components = { itemId: string; qty: string }[];

/**
 * Every component must be an item still in the catalogue; one that is archived or unknown answers
 * `kit_item_archived`. The items are locked, so none is archived while the kit is written.
 */
async function assertLiveItems(ctx: CommandContext, components: Components): Promise<void> {
  const ids = components.map((c) => c.itemId);
  const live = await ctx.tx
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(
      and(
        inArray(schema.items.id, ids),
        eq(schema.items.isActive, true),
        isNull(schema.items.archivedAt),
      ),
    )
    .for('share');
  if (live.length !== new Set(ids).size) {
    throw new DomainError('validation_failed', 'a component is not in the catalogue', {
      reason: 'kit_item_archived',
    });
  }
}

async function insertComponents(ctx: CommandContext, kitId: string, components: Components) {
  await ctx.tx.insert(schema.kitComponents).values(
    components.map((c) => ({
      id: newId(),
      kitId,
      itemId: c.itemId,
      qty: c.qty,
      createdBy: ctx.principal.id,
    })),
  );
}

/** Components as the audit trail keeps them, in item order so two sets compare line by line. */
const auditedComponents = (components: Components) =>
  [...components]
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
    .map((c) => ({ itemId: c.itemId, qty: String(Number(c.qty)) }));

/** `catalogue.kit.create` (INV-03): a kit sold as one line, with its items and quantities. */
export const createKit = defineCommand({
  name: 'catalogue.kit.create',
  permission: 'catalogue.write',
  minScope: 'entity',
  input: CreateKitInput,
  output: KitDetailDto,
  auditFields: ['sku', 'name', 'components', 'isActive'],
  constraintReasons: { kits_sku_unique: 'kit_sku_taken' },
  async handler(ctx, input) {
    await assertLiveItems(ctx, input.components);
    const [row] = await ctx.tx
      .insert(schema.kits)
      .values({ id: newId(), sku: input.sku, name: input.name, createdBy: ctx.principal.id })
      .returning();
    if (!row) throw new DomainError('internal', 'kit insert returned no row');
    await insertComponents(ctx, row.id, input.components);
    ctx.audit({
      aggregateType: 'kit',
      aggregateId: row.id,
      entityId: null,
      before: null,
      after: { sku: row.sku, name: row.name, components: auditedComponents(input.components) },
    });
    ctx.emit({
      type: 'catalogue.kit.created',
      entityId: eventEntity(ctx),
      aggregateType: 'kit',
      aggregateId: row.id,
      payload: { components: input.components.length },
    });
    return readKitDetail(ctx.tx, row.id);
  },
});

/**
 * `catalogue.kit.update`: the kit's code, name and components, the components replaced as a set.
 * Quotes already made keep the lines they recorded.
 */
export const updateKit = defineCommand({
  name: 'catalogue.kit.update',
  permission: 'catalogue.write',
  minScope: 'entity',
  input: UpdateKitInput,
  output: KitDetailDto,
  auditFields: ['sku', 'name', 'components', 'isActive'],
  constraintReasons: { kits_sku_unique: 'kit_sku_taken' },
  async handler(ctx, input) {
    const [before] = await ctx.tx
      .select()
      .from(schema.kits)
      .where(and(eq(schema.kits.id, input.kitId), isNull(schema.kits.archivedAt)))
      .limit(1)
      .for('update');
    if (!before) {
      throw new DomainError('not_found', `kit ${input.kitId} is not in the catalogue`, {
        reason: 'catalogue_kit_missing',
      });
    }
    await assertLiveItems(ctx, input.components);
    const kc = schema.kitComponents;
    const previous = await ctx.tx
      .select({ itemId: kc.itemId, qty: kc.qty })
      .from(kc)
      .where(eq(kc.kitId, input.kitId));
    const [row] = await ctx.tx
      .update(schema.kits)
      .set({ sku: input.sku, name: input.name, updatedBy: ctx.principal.id })
      .where(eq(schema.kits.id, input.kitId))
      .returning();
    if (!row) throw new DomainError('internal', 'kit update returned no row');
    await ctx.tx.delete(kc).where(eq(kc.kitId, input.kitId));
    await insertComponents(ctx, input.kitId, input.components);
    ctx.audit({
      aggregateType: 'kit',
      aggregateId: row.id,
      entityId: null,
      before: { sku: before.sku, name: before.name, components: auditedComponents(previous) },
      after: { sku: row.sku, name: row.name, components: auditedComponents(input.components) },
    });
    ctx.emit({
      type: 'catalogue.kit.updated',
      entityId: eventEntity(ctx),
      aggregateType: 'kit',
      aggregateId: row.id,
      payload: { components: input.components.length },
    });
    return readKitDetail(ctx.tx, row.id);
  },
});

/** `catalogue.kit.archive`: the kit is no longer sold or priced; quotes made keep it. */
export const archiveKit = defineCommand({
  name: 'catalogue.kit.archive',
  permission: 'catalogue.write',
  minScope: 'entity',
  input: ArchiveKitInput,
  output: KitDetailDto,
  auditFields: ['isActive'],
  async handler(ctx, input) {
    const [row] = await ctx.tx
      .update(schema.kits)
      .set({ isActive: false, archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(and(eq(schema.kits.id, input.kitId), isNull(schema.kits.archivedAt)))
      .returning();
    if (!row) {
      throw new DomainError('not_found', `kit ${input.kitId} is not in the catalogue`, {
        reason: 'catalogue_kit_missing',
      });
    }
    ctx.audit({
      aggregateType: 'kit',
      aggregateId: row.id,
      entityId: null,
      before: { isActive: true },
      after: { isActive: false },
    });
    ctx.emit({
      type: 'catalogue.kit.archived',
      entityId: eventEntity(ctx),
      aggregateType: 'kit',
      aggregateId: row.id,
      payload: {},
    });
    return readKitDetail(ctx.tx, row.id);
  },
});
