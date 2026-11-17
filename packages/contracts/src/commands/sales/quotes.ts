import { z } from 'zod';
import { SubsidySchemeSchema } from '../../crm/sizing';
import { EntityIdSchema, IdSchema } from '../../ids';
import { QuantitySchema } from '../../tax/engine';

/**
 * One line a person asks for: an item or a kit from the catalogue, how many, and whether it is
 * supplied and installed as one works contract (the composite supply of ADR 0007, which applies
 * only in the segments the workshop defaults name). Never a price, a rate or an amount: the
 * object is strict, so a line that carries one is refused (SAL-03), and every amount comes from
 * the Price Master and the tax engine.
 */
/** The largest quantity one line takes: a quotation's line, never a typing slip of millions. */
export const QUOTE_MAX_QTY = 100_000;

export const QuoteLineInput = z
  .object({
    itemId: IdSchema.optional(),
    kitId: IdSchema.optional(),
    qty: QuantitySchema.refine((qty) => Number(qty) <= QUOTE_MAX_QTY, {
      message: 'quantity above the most one line takes',
    }),
    worksContract: z.boolean().default(false),
  })
  .strict()
  .refine((line) => (line.itemId === undefined) !== (line.kitId === undefined), {
    message: 'a line is an item or a kit',
  });
export type QuoteLineInput = z.input<typeof QuoteLineInput>;

/** The most lines one quote holds: a quotation, not a bill of materials. */
export const QUOTE_MAX_LINES = 40;

/**
 * `sales.quote.create` (docs/03-roadmap-appendix/phase1.md §7.3): a quote for a lead, its lines priced from the
 * live price list of the customer's tier in the lead's company. The same shape previews a quote
 * (`sales.quote.preview`) without saving it.
 */
export const CreateQuoteInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    /** The subsidy scheme the system is sold under; the DCR rule depends on it. */
    scheme: SubsidySchemeSchema.default('none'),
    lines: z.array(QuoteLineInput).min(1).max(QUOTE_MAX_LINES),
  })
  .strict();
export type CreateQuoteInput = z.input<typeof CreateQuoteInput>;

/** One quote of a company, for `sales.quote.send` and the reads of one quote. */
export const QuoteRefInput = z.object({ entityId: EntityIdSchema, quoteId: IdSchema }).strict();
export type QuoteRefInput = z.input<typeof QuoteRefInput>;

/**
 * How a quote is sent (docs/03-roadmap-appendix/phase2.md §7.1): `recorded`, handed over by the
 * person and recorded as sent (Phase 1's way, the default), or `whatsapp`, sent by the company's
 * WhatsApp number with its PDF and an Accept button.
 */
export const QUOTE_SEND_CHANNELS = ['recorded', 'whatsapp'] as const;
export const QuoteSendChannelSchema = z.enum(QUOTE_SEND_CHANNELS);
export type QuoteSendChannel = z.infer<typeof QuoteSendChannelSchema>;

/** `sales.quote.send`: a draft quote marked as sent, by the channel the person chose. */
export const SendQuoteInput = z
  .object({
    entityId: EntityIdSchema,
    quoteId: IdSchema,
    channel: QuoteSendChannelSchema.default('recorded'),
  })
  .strict();
export type SendQuoteInput = z.input<typeof SendQuoteInput>;

/** `sales.quote.requote`: a new quote at today's prices in place of a sent or lapsed one. */
export const RequoteInput = QuoteRefInput;
export type RequoteInput = QuoteRefInput;

/** `sales.quote.withdraw`: why the quote no longer stands, in the person's words. */
export const WithdrawQuoteInput = z
  .object({
    entityId: EntityIdSchema,
    quoteId: IdSchema,
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export type WithdrawQuoteInput = z.input<typeof WithdrawQuoteInput>;

/**
 * `sales.quote.expire`: the daily job marks the next batch of one company's quotes whose validity
 * has passed as expired, in id order after `afterId`.
 */
export const ExpireQuotesInput = z
  .object({ entityId: EntityIdSchema, afterId: IdSchema.nullable().default(null) })
  .strict();
export type ExpireQuotesInput = z.input<typeof ExpireQuotesInput>;

/** `sales.quote.pdf.attach`: the render worker attaches the PDF it recorded to its quote. */
export const AttachQuotePdfInput = z
  .object({ entityId: EntityIdSchema, quoteId: IdSchema, fileId: IdSchema })
  .strict();
export type AttachQuotePdfInput = z.input<typeof AttachQuotePdfInput>;

/**
 * `crm.account.tier.set`: the price tier a customer's quotes are priced from, or none, set from the
 * customer's page in one company, whose timeline records it.
 */
export const SetAccountTierInput = z
  .object({ entityId: EntityIdSchema, accountId: IdSchema, tierId: IdSchema.nullable() })
  .strict();
export type SetAccountTierInput = z.input<typeof SetAccountTierInput>;
