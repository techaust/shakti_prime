import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * `pricing.list.create` (SAL-01, BLUEPRINT §8.3): a price list version for a tier, for one
 * company or (with no company) for the whole group, from a date that is today or later. It starts
 * as a draft holding a copy of the prices in force on the day before it starts: the company's own
 * list of that tier then, else the group's. A draft prices nothing until `pricing.list.approve`.
 */
export const CreatePriceListInput = z
  .object({
    /** A tier's code (`retail`, `dealer`, `commercial` or one added later). */
    tierCode: z.string().trim().min(1).max(40),
    entityId: EntityIdSchema.optional(),
    effectiveFrom: z.iso.date(),
  })
  .strict();
export type CreatePriceListInput = z.infer<typeof CreatePriceListInput>;

/**
 * `pricing.list.approve`: the draft becomes the tier's list from its start date. The list live on
 * that date ends where it starts, and it ends itself where a later approved list starts.
 */
export const ApprovePriceListInput = z.object({ priceListId: IdSchema }).strict();
export type ApprovePriceListInput = z.infer<typeof ApprovePriceListInput>;

/**
 * `pricing.list.archive`: withdraws a draft or a scheduled list. A live or ended list is kept, since
 * quotes were priced from it.
 */
export const ArchivePriceListInput = z.object({ priceListId: IdSchema }).strict();
export type ArchivePriceListInput = z.infer<typeof ArchivePriceListInput>;
