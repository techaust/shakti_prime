import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { AccountTypeSchema } from '../crm/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { CalendarDateSchema, StateCodeSchema, SupplyKindSchema } from '../tax/engine';
import { QuoteChoiceDto, QuoteLineDto, QuoteTotalsDto } from './quote';

/**
 * Where a sales order stands (docs/design/phase1.md §8.3, the sales order machine). Phase 1 moves
 * an order between draft, confirmed and cancelled; the dispatch states come with the stock ledger
 * (Phase 3), invoiced and closed with the Tally link (Phase 5).
 */
export const SalesOrderStateSchema = z.enum([
  'draft',
  'confirmed',
  'partially_dispatched',
  'dispatched',
  'invoiced',
  'closed',
  'cancelled',
]);
export type SalesOrderState = z.infer<typeof SalesOrderStateSchema>;

/** Why the dealer credit check held a confirmation (SAL-07, `creditCheck()`). */
export const CreditHoldReasonSchema = z.enum([
  'credit_limit_exceeded',
  'credit_overdue',
  'credit_limit_missing',
]);
export type CreditHoldReason = z.infer<typeof CreditHoldReasonSchema>;

/**
 * A credit hold as the order keeps it: the rule and the facts its sentence names, the limit and
 * the exposure (outstanding, the confirmed unpaid orders and this order), or the overdue invoice
 * with its days and the dealer's credit days.
 */
export const CreditHoldDto = z
  .object({
    reason: CreditHoldReasonSchema,
    heldAt: z.iso.datetime(),
    limit: MoneySchema.nullable(),
    exposure: MoneySchema.nullable(),
    invoiceNo: z.string().nullable(),
    overdueDays: z.number().int().nullable(),
    creditDays: z.number().int().nullable(),
  })
  .strict();
export type CreditHoldDto = z.infer<typeof CreditHoldDto>;

/** The Executive's release of a hold (`sales.credit.release`). */
export const CreditReleaseDto = z
  .object({ byName: z.string().nullable(), reason: z.string(), releasedAt: z.iso.datetime() })
  .strict();
export type CreditReleaseDto = z.infer<typeof CreditReleaseDto>;

/** One order with its lines, as the order page shows it. */
export const SalesOrderDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    soNo: z.string(),
    quoteId: IdSchema.nullable(),
    quoteNo: z.string().nullable(),
    opportunityId: IdSchema.nullable(),
    accountId: IdSchema,
    customerName: z.string(),
    accountType: AccountTypeSchema,
    siteId: IdSchema.nullable(),
    tierId: IdSchema,
    /** The tier's name for a caller who reads the price tiers (`pricing.read`); null otherwise. */
    tierName: z.string().nullable(),
    priceListId: IdSchema.nullable(),
    placeOfSupplyState: StateCodeSchema,
    supplyKind: SupplyKindSchema,
    state: SalesOrderStateSchema,
    lines: z.array(QuoteLineDto),
    totals: QuoteTotalsDto,
    createdAt: z.iso.datetime(),
    createdByName: z.string().nullable(),
    stateChangedAt: z.iso.datetime(),
    confirmedAt: z.iso.datetime().nullable(),
    confirmedByName: z.string().nullable(),
    creditHold: CreditHoldDto.nullable(),
    creditRelease: CreditReleaseDto.nullable(),
    cancelReason: z.string().nullable(),
    /** What the caller may do with it now (the commands check again). */
    canConfirm: z.boolean(),
    canRelease: z.boolean(),
    canCancel: z.boolean(),
  })
  .strict();
export type SalesOrderDto = z.infer<typeof SalesOrderDto>;

/**
 * What `sales.order.confirm` answers: the order confirmed, or held for credit with the facts of
 * the hold on the order (a hold is not a refusal: it is kept, and the Executive may release it).
 */
export const ConfirmSalesOrderDto = z
  .object({ outcome: z.enum(['confirmed', 'held']), order: SalesOrderDto })
  .strict();
export type ConfirmSalesOrderDto = z.infer<typeof ConfirmSalesOrderDto>;

/** One row of `/orders` and of Account 360's orders: never a line, a cost or a phone. */
export const SalesOrderRowDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    soNo: z.string(),
    opportunityId: IdSchema.nullable(),
    quoteId: IdSchema.nullable(),
    accountId: IdSchema,
    customerName: z.string(),
    state: SalesOrderStateSchema,
    creditHeld: z.boolean(),
    grandTotal: MoneySchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type SalesOrderRowDto = z.infer<typeof SalesOrderRowDto>;

export const SalesOrderPageDto = z
  .object({ items: z.array(SalesOrderRowDto), nextCursor: z.string().nullable() })
  .strict();
export type SalesOrderPageDto = z.infer<typeof SalesOrderPageDto>;

/** `/orders`: the newest orders first, of one company or every company of the request. */
export const ListSalesOrdersInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    state: SalesOrderStateSchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListSalesOrdersInput = z.input<typeof ListSalesOrdersInput>;

/** The dealer's order form: the tier and list it would be priced from, and the priced choices. */
export const SalesOrderBuilderDto = z
  .object({
    entityId: EntityIdSchema,
    accountId: IdSchema,
    customerName: z.string(),
    tierName: z.string().nullable(),
    priceListId: IdSchema.nullable(),
    choices: z.array(QuoteChoiceDto),
    today: CalendarDateSchema,
  })
  .strict();
export type SalesOrderBuilderDto = z.infer<typeof SalesOrderBuilderDto>;

export const SalesOrderBuilderInput = z
  .object({ entityId: EntityIdSchema, accountId: IdSchema })
  .strict();
export type SalesOrderBuilderInput = z.input<typeof SalesOrderBuilderInput>;

/** A dealer's order worked out but not saved: what `sales.order.create` would make today. */
export const SalesOrderPreviewDto = z
  .object({
    tierId: IdSchema,
    tierName: z.string(),
    priceListId: IdSchema,
    placeOfSupplyState: StateCodeSchema,
    supplyKind: SupplyKindSchema,
    lines: z.array(QuoteLineDto),
    totals: QuoteTotalsDto,
  })
  .strict();
export type SalesOrderPreviewDto = z.infer<typeof SalesOrderPreviewDto>;

/** A dealer's terms entry (`dealer_terms`), as `/dealer-credit` shows its history. */
export const DealerTermsDto = z
  .object({
    id: IdSchema,
    accountId: IdSchema,
    entityId: EntityIdSchema,
    creditLimit: MoneySchema.nullable(),
    creditDays: z.number().int().nullable(),
    enteredAt: z.iso.datetime(),
    enteredByName: z.string().nullable(),
  })
  .strict();
export type DealerTermsDto = z.infer<typeof DealerTermsDto>;

/** A dealer's outstanding entry (`dealer_outstanding`). */
export const DealerOutstandingDto = z
  .object({
    id: IdSchema,
    accountId: IdSchema,
    entityId: EntityIdSchema,
    outstanding: MoneySchema,
    oldestOverdueDays: z.number().int().nullable(),
    oldestOverdueInvoiceNo: z.string().nullable(),
    asOf: CalendarDateSchema,
    enteredAt: z.iso.datetime(),
    enteredByName: z.string().nullable(),
  })
  .strict();
export type DealerOutstandingDto = z.infer<typeof DealerOutstandingDto>;

/**
 * One dealer of `/dealer-credit` in one company: the newest terms, the newest outstanding entry
 * and its date, the confirmed orders not yet in that figure, and the exposure the credit check
 * reads (outstanding plus those orders).
 */
export const DealerCreditRowDto = z
  .object({
    accountId: IdSchema,
    name: z.string(),
    creditLimit: MoneySchema.nullable(),
    creditDays: z.number().int().nullable(),
    termsAt: z.iso.datetime().nullable(),
    outstanding: MoneySchema.nullable(),
    oldestOverdueDays: z.number().int().nullable(),
    oldestOverdueInvoiceNo: z.string().nullable(),
    asOf: CalendarDateSchema.nullable(),
    confirmedUnpaid: MoneySchema,
    exposure: MoneySchema,
  })
  .strict();
export type DealerCreditRowDto = z.infer<typeof DealerCreditRowDto>;

export const DealerCreditPageDto = z
  .object({ items: z.array(DealerCreditRowDto), nextCursor: z.string().nullable() })
  .strict();
export type DealerCreditPageDto = z.infer<typeof DealerCreditPageDto>;

/** `/dealer-credit`: the dealers of one company by name. */
export const ListDealerCreditInput = z
  .object({
    entityId: EntityIdSchema,
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListDealerCreditInput = z.input<typeof ListDealerCreditInput>;

/** One dealer's entries in one company, newest first. */
export const DealerCreditHistoryInput = z
  .object({ entityId: EntityIdSchema, accountId: IdSchema })
  .strict();
export type DealerCreditHistoryInput = z.input<typeof DealerCreditHistoryInput>;

export const DealerCreditHistoryDto = z
  .object({
    accountId: IdSchema,
    entityId: EntityIdSchema,
    terms: z.array(DealerTermsDto),
    outstanding: z.array(DealerOutstandingDto),
  })
  .strict();
export type DealerCreditHistoryDto = z.infer<typeof DealerCreditHistoryDto>;
