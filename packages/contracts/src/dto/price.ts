import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';

/** One price on one price list: an item or a kit, never both. Strict. */
export const PriceListItemDto = z
  .object({
    id: IdSchema,
    priceListId: IdSchema,
    entityId: EntityIdSchema.nullable(),
    tierCode: z.string(),
    itemId: IdSchema.nullable(),
    kitId: IdSchema.nullable(),
    price: MoneySchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type PriceListItemDto = z.infer<typeof PriceListItemDto>;
