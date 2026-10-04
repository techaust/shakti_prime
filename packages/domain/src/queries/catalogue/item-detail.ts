import {
  DomainError,
  ItemDetailDto,
  KitDetailDto,
  type ItemSpecs,
  type KitComponentDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { asc, eq } from 'drizzle-orm';
import { toItemDto } from './item-dto';

type Tx = RequestContext['tx'];

/** An item's curve points by rising flow, as the sheet and the sizing calculator read them. */
export async function readPumpCurve(tx: Tx, itemId: string) {
  const pc = schema.pumpCurves;
  return tx
    .select({ flowLph: pc.flowLph, headM: pc.headM })
    .from(pc)
    .where(eq(pc.itemId, itemId))
    .orderBy(asc(pc.flowLph));
}

/**
 * The item sheet: one item, archived or not, with its specifications and curve. Items are shared
 * by every company, so any reader with a request context sees the same item. Never reads cost.
 */
export async function readItemDetail(tx: Tx, itemId: string): Promise<ItemDetailDto> {
  const [item] = await tx.select().from(schema.items).where(eq(schema.items.id, itemId)).limit(1);
  if (!item) {
    throw new DomainError('not_found', `item ${itemId} is not visible`, {
      reason: 'catalogue_item_missing',
    });
  }
  const curve = await readPumpCurve(tx, itemId);
  return ItemDetailDto.parse({
    ...toItemDto(item),
    specs: item.specsJson as ItemSpecs,
    curve: curve.map((p) => ({ flowLph: trimZeros(p.flowLph), headM: trimZeros(p.headM) })),
  });
}

/** `12.50` → `12.5`, `600.00` → `600`: the curve reads as it was typed. */
function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/** The kit sheet: one kit with its components by item name. */
export async function readKitDetail(tx: Tx, kitId: string): Promise<KitDetailDto> {
  const [kit] = await tx.select().from(schema.kits).where(eq(schema.kits.id, kitId)).limit(1);
  if (!kit) {
    throw new DomainError('not_found', `kit ${kitId} is not visible`, {
      reason: 'catalogue_kit_missing',
    });
  }
  const kc = schema.kitComponents;
  const i = schema.items;
  const rows = await tx
    .select({
      itemId: i.id,
      sku: i.sku,
      name: i.name,
      category: i.category,
      unit: i.unit,
      qty: kc.qty,
      isActive: i.isActive,
      archivedAt: i.archivedAt,
    })
    .from(kc)
    .innerJoin(i, eq(i.id, kc.itemId))
    .where(eq(kc.kitId, kitId))
    .orderBy(asc(i.name), asc(i.id));
  const components: KitComponentDto[] = rows.map((r) => ({
    itemId: r.itemId,
    sku: r.sku,
    name: r.name,
    category: r.category as KitComponentDto['category'],
    unit: r.unit as KitComponentDto['unit'],
    qty: trimZeros(r.qty),
    itemActive: r.isActive && r.archivedAt === null,
  }));
  return KitDetailDto.parse({
    id: kit.id,
    sku: kit.sku,
    name: kit.name,
    isActive: kit.isActive && kit.archivedAt === null,
    componentCount: components.length,
    updatedAt: kit.updatedAt.toISOString(),
    components,
  });
}
