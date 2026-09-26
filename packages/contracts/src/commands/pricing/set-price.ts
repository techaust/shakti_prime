import { z } from 'zod';
import { MoneySchema } from '../../catalogue/enums';
import { IdSchema } from '../../ids';

/**
 * `pricing.price.set`: an Executive sets the price of one item or kit on a price list (SAL-01).
 * Every change is logged; there is no other way to change a price.
 */
export const SetPriceInput = z
  .object({
    priceListId: IdSchema,
    itemId: IdSchema.optional(),
    kitId: IdSchema.optional(),
    price: MoneySchema.refine((p) => Number(p) > 0, { message: 'price must be above zero' }),
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((v) => (v.itemId === undefined) !== (v.kitId === undefined), {
    message: 'exactly one of itemId or kitId',
    path: ['itemId'],
  });
export type SetPriceInput = z.infer<typeof SetPriceInput>;
