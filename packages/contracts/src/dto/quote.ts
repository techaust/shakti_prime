import { z } from 'zod';
import { MoneySchema, SignedMoneySchema, HsnSchema, ItemUnitSchema } from '../catalogue/enums';
import { SegmentSchema } from '../crm/enums';
import { SizingKindSchema, SubsidySchemeSchema } from '../crm/sizing';
import { EntityIdSchema, IdSchema } from '../ids';
import { CalendarDateSchema, PercentSchema, StateCodeSchema, SupplyKindSchema } from '../tax/engine';

/**
 * Where a quote stands (docs/design/phase1.md §7.3, the quote machine). `quotes.state` holds the
 * stored state; a read answers a draft or sent quote whose validity has passed as `expired`
 * before the daily job marks it.
 */
export const QuoteStateSchema = z.enum([
  'draft',
  'sent',
  'accepted',
  'expired',
  'superseded',
  'withdrawn',
]);
export type QuoteState = z.infer<typeof QuoteStateSchema>;

/** One priced line as the quote keeps it: the Price Master price and the engine's tax. */
export const QuoteLineDto = z
  .object({
    position: z.number().int().min(1),
    itemId: IdSchema.nullable(),
    kitId: IdSchema.nullable(),
    /** The item's or kit's name and code when the quote was made. */
    description: z.string(),
    sku: z.string(),
    unit: ItemUnitSchema,
    qty: z.string(),
    unitPrice: MoneySchema,
    /** Null for a kit, which has no HSN code of its own. */
    hsn: HsnSchema.nullable(),
    worksContract: z.boolean(),
    taxRateId: IdSchema.nullable(),
    /** The GST rate of a line taxed at its own rate; null for a composite line. */
    taxRatePct: PercentSchema.nullable(),
    compositeRuleId: IdSchema.nullable(),
    /** The goods and services rates of a composite line; null otherwise. */
    goodsRatePct: PercentSchema.nullable(),
    servicesRatePct: PercentSchema.nullable(),
    taxableValue: MoneySchema,
    goodsTaxable: MoneySchema.nullable(),
    servicesTaxable: MoneySchema.nullable(),
    cgst: MoneySchema,
    sgst: MoneySchema,
    igst: MoneySchema,
    lineTotal: MoneySchema,
  })
  .strict();
export type QuoteLineDto = z.infer<typeof QuoteLineDto>;

/** The totals of a quote (ADR 0007): each tax head, the rupee round-off and the total. */
export const QuoteTotalsDto = z
  .object({
    subtotal: MoneySchema,
    cgst: MoneySchema,
    sgst: MoneySchema,
    igst: MoneySchema,
    taxTotal: MoneySchema,
    roundOff: SignedMoneySchema,
    grandTotal: MoneySchema,
  })
  .strict();
export type QuoteTotalsDto = z.infer<typeof QuoteTotalsDto>;

/** What a quote is priced and taxed with: the tier, the list, and the place of supply. */
const pricedWith = {
  tierId: IdSchema,
  tierName: z.string(),
  priceListId: IdSchema,
  scheme: SubsidySchemeSchema,
  placeOfSupplyState: StateCodeSchema,
  supplyKind: SupplyKindSchema,
  /** End of the last valid day, in IST. */
  validUntil: z.iso.datetime(),
};

/**
 * A quote worked out but not saved (`sales.quote.preview`): what `sales.quote.create` would make
 * from the same lines today. The number is given only when the quote is made.
 */
export const QuotePreviewDto = z
  .object({ ...pricedWith, lines: z.array(QuoteLineDto), totals: QuoteTotalsDto })
  .strict();
export type QuotePreviewDto = z.infer<typeof QuotePreviewDto>;

/** One quote with its lines, as the quote page shows it. */
export const QuoteDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    quoteNo: z.string(),
    opportunityId: IdSchema,
    accountId: IdSchema,
    customerName: z.string(),
    segment: SegmentSchema,
    siteId: IdSchema.nullable(),
    sizingId: IdSchema.nullable(),
    ...pricedWith,
    state: QuoteStateSchema,
    lines: z.array(QuoteLineDto),
    totals: QuoteTotalsDto,
    /** The PDF once the render worker has attached it. */
    pdfFileId: IdSchema.nullable(),
    supersedesId: IdSchema.nullable(),
    supersedesNo: z.string().nullable(),
    supersededById: IdSchema.nullable(),
    supersededByNo: z.string().nullable(),
    withdrawnReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    createdByName: z.string().nullable(),
    stateChangedAt: z.iso.datetime(),
    /** What the caller may do with it now (the commands check again). */
    canSend: z.boolean(),
    canRequote: z.boolean(),
    canWithdraw: z.boolean(),
  })
  .strict();
export type QuoteDto = z.infer<typeof QuoteDto>;

/** One row of `/quotes` and of Account 360's quotes: never a line, a cost or a phone. */
export const QuoteRowDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    quoteNo: z.string(),
    opportunityId: IdSchema,
    accountId: IdSchema,
    customerName: z.string(),
    state: QuoteStateSchema,
    grandTotal: MoneySchema,
    validUntil: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type QuoteRowDto = z.infer<typeof QuoteRowDto>;

export const QuotePageDto = z
  .object({ items: z.array(QuoteRowDto), nextCursor: z.string().nullable() })
  .strict();
export type QuotePageDto = z.infer<typeof QuotePageDto>;

/** `/quotes`: the newest quotes first, of one company or every company of the request. */
export const ListQuotesInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    state: QuoteStateSchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListQuotesInput = z.input<typeof ListQuotesInput>;

/** A quote the ⌘K search found by its number (RPT-03). */
export const QuoteSearchHitDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    quoteNo: z.string(),
    customerName: z.string(),
    state: QuoteStateSchema,
  })
  .strict();
export type QuoteSearchHitDto = z.infer<typeof QuoteSearchHitDto>;

/** One item or kit the builder offers: its price on the list the quote would use. */
export const QuoteChoiceDto = z
  .object({
    kind: z.enum(['item', 'kit']),
    id: IdSchema,
    sku: z.string(),
    name: z.string(),
    unit: ItemUnitSchema,
    price: MoneySchema,
  })
  .strict();
export type QuoteChoiceDto = z.infer<typeof QuoteChoiceDto>;

/** The lead's newest sizing as the builder names it. */
export const QuoteSizingSummaryDto = z
  .object({
    kind: SizingKindSchema,
    inBounds: z.boolean(),
    /** The pump's rating in HP, or the system's size in kWp. */
    hp: z.number().nullable(),
    kwp: z.number().nullable(),
    stale: z.boolean(),
  })
  .strict();
export type QuoteSizingSummaryDto = z.infer<typeof QuoteSizingSummaryDto>;

/**
 * The quote builder of one lead: who the customer is, the tier and list the quote would be priced
 * from (null when there is none, and the builder says why), the newest sizing and the priced
 * choices.
 */
export const QuoteBuilderDto = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    accountId: IdSchema,
    customerName: z.string(),
    segment: SegmentSchema,
    pipelineName: z.string(),
    tierName: z.string().nullable(),
    priceListId: IdSchema.nullable(),
    sizing: QuoteSizingSummaryDto.nullable(),
    choices: z.array(QuoteChoiceDto),
    /** Today in IST, the day the prices and rates are read for. */
    today: CalendarDateSchema,
  })
  .strict();
export type QuoteBuilderDto = z.infer<typeof QuoteBuilderDto>;

export const QuoteBuilderInput = z
  .object({ entityId: EntityIdSchema, opportunityId: IdSchema })
  .strict();
export type QuoteBuilderInput = z.input<typeof QuoteBuilderInput>;

/** What `sales.quote.expire` did for one batch, and where the next starts. */
export const QuoteExpiryBatchDto = z
  .object({
    entityId: EntityIdSchema,
    expired: z.number().int().min(0),
    nextAfterId: IdSchema.nullable(),
  })
  .strict();
export type QuoteExpiryBatchDto = z.infer<typeof QuoteExpiryBatchDto>;

/** A price tier a customer may be put on (Account 360). */
export const PriceTierOptionDto = z
  .object({ id: IdSchema, code: z.string(), name: z.string() })
  .strict();
export type PriceTierOptionDto = z.infer<typeof PriceTierOptionDto>;

/** A customer's price tier after `crm.account.tier.set`. */
export const AccountTierDto = z
  .object({ accountId: IdSchema, tierId: IdSchema.nullable() })
  .strict();
export type AccountTierDto = z.infer<typeof AccountTierDto>;

/** What `sales.quote.pdf.attach` answers: the quote and the PDF it now names. */
export const QuotePdfDto = z.object({ quoteId: IdSchema, pdfFileId: IdSchema }).strict();
export type QuotePdfDto = z.infer<typeof QuotePdfDto>;
