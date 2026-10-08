import { z } from 'zod';
import { MoneySchema } from '../../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../../ids';
import { CalendarDateSchema, QuantitySchema } from '../../tax/engine';
import { QUOTE_MAX_LINES, QUOTE_MAX_QTY } from './quotes';

/**
 * `sales.quote.accept` (docs/03-roadmap-appendix/phase1.md §8.3, PRD SAL-05): a sent quote accepted by the
 * customer's signed copy, uploaded by staff as a `signed_quote` file of the quote's company.
 */
export const AcceptQuoteInput = z
  .object({ entityId: EntityIdSchema, quoteId: IdSchema, signedFileId: IdSchema })
  .strict();
export type AcceptQuoteInput = z.input<typeof AcceptQuoteInput>;

/**
 * One line of a dealer's order: an item or a kit and how many. Never a price, a rate or an
 * amount: the object is strict, so a line that carries one is refused (SAL-03), and every amount
 * comes from the Price Master of the dealer's tier and the tax engine.
 */
export const OrderLineInput = z
  .object({
    itemId: IdSchema.optional(),
    kitId: IdSchema.optional(),
    qty: QuantitySchema.refine((qty) => Number(qty) <= QUOTE_MAX_QTY, {
      message: 'quantity above the most one line takes',
    }),
  })
  .strict()
  .refine((line) => (line.itemId === undefined) !== (line.kitId === undefined), {
    message: 'a line is an item or a kit',
  });
export type OrderLineInput = z.input<typeof OrderLineInput>;

/**
 * `sales.order.create` (PRD SAL-06): a dealer's order without a quote, in one company, priced
 * from the live list of the dealer's tier there. The same shape previews the order without saving
 * it.
 */
export const CreateSalesOrderInput = z
  .object({
    entityId: EntityIdSchema,
    accountId: IdSchema,
    lines: z.array(OrderLineInput).min(1).max(QUOTE_MAX_LINES),
  })
  .strict();
export type CreateSalesOrderInput = z.input<typeof CreateSalesOrderInput>;

/** One order of a company, for `sales.order.confirm` and the reads of one order. */
export const SalesOrderRefInput = z
  .object({ entityId: EntityIdSchema, orderId: IdSchema })
  .strict();
export type SalesOrderRefInput = z.input<typeof SalesOrderRefInput>;

/** `sales.credit.release` and `sales.order.cancel`: an order and why, in the person's words. */
export const SalesOrderReasonInput = z
  .object({
    entityId: EntityIdSchema,
    orderId: IdSchema,
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export type SalesOrderReasonInput = z.input<typeof SalesOrderReasonInput>;

/** The longest credit days a dealer is given. */
export const CREDIT_DAYS_MAX = 365;

/**
 * `sales.dealer_terms.set` (SALE-4): a dealer's credit limit and credit days in one company, as
 * Accounts enter them; a limit left empty means none is set, which holds every order (SAL-07).
 */
export const SetDealerTermsInput = z
  .object({
    entityId: EntityIdSchema,
    accountId: IdSchema,
    creditLimit: MoneySchema.nullable(),
    creditDays: z.number().int().min(0).max(CREDIT_DAYS_MAX).nullable(),
  })
  .strict();
export type SetDealerTermsInput = z.input<typeof SetDealerTermsInput>;

/**
 * `sales.dealer_outstanding.record` (SALE-6): what a dealer owes in one company on a date, and
 * the oldest unpaid invoice with its date, as Accounts read them from Tally until the sync
 * brings them (Phase 5).
 */
export const RecordDealerOutstandingInput = z
  .object({
    entityId: EntityIdSchema,
    accountId: IdSchema,
    outstanding: MoneySchema,
    oldestUnpaidInvoiceDate: CalendarDateSchema.nullable(),
    oldestUnpaidInvoiceNo: z.string().trim().min(1).max(60).nullable(),
    asOf: CalendarDateSchema,
  })
  .strict()
  .refine((v) => (v.oldestUnpaidInvoiceDate === null) === (v.oldestUnpaidInvoiceNo === null), {
    message: 'an unpaid invoice comes with its date',
    path: ['oldestUnpaidInvoiceNo'],
  })
  .refine((v) => v.oldestUnpaidInvoiceDate === null || v.oldestUnpaidInvoiceDate <= v.asOf, {
    message: 'an invoice is not dated after the figure it is part of',
    path: ['oldestUnpaidInvoiceDate'],
  });
export type RecordDealerOutstandingInput = z.input<typeof RecordDealerOutstandingInput>;
