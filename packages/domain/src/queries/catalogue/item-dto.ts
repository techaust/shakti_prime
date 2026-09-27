import { ItemDto, ItemWithCostDto, type ItemCostDto } from '@shakti/contracts';
import type { schema } from '@shakti/db';

type ItemRow = typeof schema.items.$inferSelect;
type ItemCostRow = typeof schema.itemCosts.$inferSelect;

/** Shapes an item row for every reader. Cost columns never pass through here. */
export function toItemDto(item: ItemRow): ItemDto {
  return ItemDto.parse({
    id: item.id,
    sku: item.sku,
    name: item.name,
    category: item.category,
    hsn: item.hsn,
    unit: item.unit,
    isSerialTracked: item.isSerialTracked,
    isDcr: item.isDcr,
    almmRef: item.almmRef,
    isActive: item.isActive,
    updatedAt: item.updatedAt.toISOString(),
  });
}

/** Adds the cost side; only `listItemsWithCost` calls this, behind `finance.cost.read`. */
export function toItemWithCostDto(item: ItemRow, cost: ItemCostRow | null): ItemWithCostDto {
  const costDto: ItemCostDto | null = cost
    ? {
        entityId: cost.entityId,
        movingAvgCost: cost.movingAvgCost,
        lastPurchaseRate: cost.lastPurchaseRate,
        asOf: cost.asOf?.toISOString() ?? null,
      }
    : null;
  return ItemWithCostDto.parse({ ...toItemDto(item), cost: costDto });
}
