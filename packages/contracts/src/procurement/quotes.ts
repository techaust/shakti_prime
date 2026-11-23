import { z } from 'zod';
import { ItemCategorySchema, ItemUnitSchema, RateSchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { CalendarDateSchema, QuantitySchema } from '../tax/engine';
import { ItemVendorDto, VendorContactDto, VendorDto, VENDOR_DAYS_MAX } from './vendors';

/**
 * Supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3, docs/05-database.md §4.3): every value
 * here is behind `procurement.rate.read`. A DTO that carries a rate is built only by a query or
 * command that checked the grant; the shapes without rates (`VendorSheetDto`) are built without
 * reading `vendor_quotes` at all.
 */

/**
 * A rate as a person types it, in rupees per purchase unit excluding GST: up to ten digits and
 * four decimals, above zero. Stored as `numeric(14,4)`.
 */
export const RateInputSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,4})?$/)
  .refine((value) => Number(value) > 0, { message: 'rate must be above zero' });

/** A minimum order as a person types it: up to three decimals, above zero. */
const MoqInputSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/)
  .refine((value) => Number(value) > 0, { message: 'minimum order must be above zero' });

/**
 * `procurement.quote.record`: a supplier's rate for an item, valid from one date to another, given
 * to one company (`entityId`) or to the group (`null`), with the quote document uploaded first
 * through the files path (purpose `vendor_quote`). Needs `procurement.rate.read` and
 * `procurement.po.write` in the company, or acting for every company for a group quote.
 */
export const RecordVendorQuoteInput = z
  .object({
    vendorId: IdSchema,
    itemId: IdSchema,
    entityId: EntityIdSchema.nullable(),
    rate: RateInputSchema,
    moq: MoqInputSchema.nullable().optional(),
    leadTimeDays: z.number().int().min(0).max(VENDOR_DAYS_MAX).nullable().optional(),
    validFrom: CalendarDateSchema,
    validUntil: CalendarDateSchema,
    fileId: IdSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => v.validUntil >= v.validFrom, {
    message: 'a quote ends on or after the day it starts',
    path: ['validUntil'],
  });
export type RecordVendorQuoteInput = z.input<typeof RecordVendorQuoteInput>;

/** `procurement.quote.withdraw`: a live quote is withdrawn; a withdrawn quote stays on record. */
export const WithdrawVendorQuoteInput = z.object({ quoteId: IdSchema }).strict();
export type WithdrawVendorQuoteInput = z.infer<typeof WithdrawVendorQuoteInput>;

/**
 * Where a quote stands on a day (in IST): `live` inside its validity, `upcoming` before it,
 * `expired` after it, `withdrawn` once withdrawn whatever its dates.
 */
export const VENDOR_QUOTE_STATUSES = ['live', 'upcoming', 'expired', 'withdrawn'] as const;
export const VendorQuoteStatusSchema = z.enum(VENDOR_QUOTE_STATUSES);
export type VendorQuoteStatus = z.infer<typeof VendorQuoteStatusSchema>;

/** A supplier quote. Only for a reader holding `procurement.rate.read`. Strict. */
export const VendorQuoteDto = z
  .object({
    id: IdSchema,
    vendorId: IdSchema,
    vendorName: z.string(),
    itemId: IdSchema,
    sku: z.string(),
    itemName: z.string(),
    unit: ItemUnitSchema,
    /** Null for a quote given to the group. */
    entityId: EntityIdSchema.nullable(),
    rate: RateSchema,
    moq: QuantitySchema.nullable(),
    leadTimeDays: z.number().int().nullable(),
    validFrom: CalendarDateSchema,
    validUntil: CalendarDateSchema,
    fileId: IdSchema.nullable(),
    status: VendorQuoteStatusSchema,
    recordedAt: z.iso.datetime(),
    withdrawnAt: z.iso.datetime().nullable(),
  })
  .strict();
export type VendorQuoteDto = z.infer<typeof VendorQuoteDto>;

/** The vendor sheet for a reader without `procurement.rate.read`: no quote, no rate. */
export const VendorSheetDto = z
  .object({
    vendor: VendorDto,
    contacts: z.array(VendorContactDto),
    items: z.array(ItemVendorDto),
  })
  .strict();
export type VendorSheetDto = z.infer<typeof VendorSheetDto>;

/** The vendor sheet for a holder of `procurement.rate.read`, with the quotes they may read. */
export const VendorSheetWithQuotesDto = VendorSheetDto.extend({
  quotes: z.array(VendorQuoteDto),
}).strict();
export type VendorSheetWithQuotesDto = z.infer<typeof VendorSheetWithQuotesDto>;

/**
 * Procurement › Compare: the items of a category down, the vendors with a quote across, for one
 * company (its own quotes and the group's).
 */
export const CompareQuotesInput = z
  .object({
    entityId: EntityIdSchema,
    category: ItemCategorySchema.optional(),
  })
  .strict();
export type CompareQuotesInput = z.input<typeof CompareQuotesInput>;

/**
 * One cell: the vendor's live quote for the item with the lowest rate, else its quote that ended
 * last, shown expired. `isLowest` marks the lowest live rate of the row and is never set on an
 * expired quote.
 */
export const CompareCellDto = z
  .object({
    vendorId: IdSchema,
    quoteId: IdSchema,
    entityId: EntityIdSchema.nullable(),
    rate: RateSchema,
    moq: QuantitySchema.nullable(),
    leadTimeDays: z.number().int().nullable(),
    validUntil: CalendarDateSchema,
    status: z.enum(['live', 'expired']),
    isLowest: z.boolean(),
    fileId: IdSchema.nullable(),
  })
  .strict();
export type CompareCellDto = z.infer<typeof CompareCellDto>;

export const CompareRowDto = z
  .object({
    itemId: IdSchema,
    sku: z.string(),
    itemName: z.string(),
    category: ItemCategorySchema,
    /** The unit the rates are per (the item's stock unit until purchase units exist). */
    unit: ItemUnitSchema,
    cells: z.array(CompareCellDto),
  })
  .strict();
export type CompareRowDto = z.infer<typeof CompareRowDto>;

export const CompareQuotesDto = z
  .object({
    entityId: EntityIdSchema,
    category: ItemCategorySchema.nullable(),
    /** The day, in IST, the quotes were judged live or expired on. */
    asOf: CalendarDateSchema,
    vendors: z.array(z.object({ id: IdSchema, name: z.string() }).strict()),
    rows: z.array(CompareRowDto),
  })
  .strict();
export type CompareQuotesDto = z.infer<typeof CompareQuotesDto>;
