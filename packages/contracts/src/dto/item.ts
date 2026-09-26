import { z } from 'zod';
import { HsnSchema, ItemUnitSchema, RateSchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';

/** An item as every catalogue reader sees it. Carries no cost field, by construction. Strict. */
export const ItemDto = z
  .object({
    id: IdSchema,
    sku: z.string(),
    name: z.string(),
    nameHi: z.string(),
    category: z.string(),
    hsn: HsnSchema,
    unit: ItemUnitSchema,
    isSerialTracked: z.boolean(),
    isDcr: z.boolean(),
    almmRef: z.string().nullable(),
    isActive: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ItemDto = z.infer<typeof ItemDto>;

/** The cost side of an item for one entity. Only reachable through `finance.cost.read`. */
export const ItemCostDto = z
  .object({
    entityId: EntityIdSchema,
    movingAvgCost: RateSchema.nullable(),
    lastPurchaseRate: RateSchema.nullable(),
    asOf: z.iso.datetime().nullable(),
  })
  .strict();
export type ItemCostDto = z.infer<typeof ItemCostDto>;

/** `WithCost` DTOs exist only for readers that hold the cost permission (docs/API.md §5). */
export const ItemWithCostDto = ItemDto.extend({ cost: ItemCostDto.nullable() }).strict();
export type ItemWithCostDto = z.infer<typeof ItemWithCostDto>;
