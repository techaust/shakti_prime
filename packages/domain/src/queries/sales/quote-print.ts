import { DomainError, HsnSchema, ItemUnitSchema, MoneySchema, SignedMoneySchema } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const money = MoneySchema;
const percent = z.string().regex(/^\d{1,3}\.\d{2}$/).nullable();

/** One line of a quote as the render worker prints it. */
const QuotePrintLineSchema = z
  .object({
    position: z.number().int().min(1),
    sku: z.string(),
    description: z.string(),
    unit: ItemUnitSchema,
    qty: z.string(),
    unitPrice: money,
    hsn: HsnSchema.nullable(),
    taxRatePct: percent,
    goodsRatePct: percent,
    servicesRatePct: percent,
    taxableValue: money,
    cgst: money,
    sgst: money,
    igst: money,
  })
  .strict();

/** What `app.quote_for_print()` answers for one quote (ADR 0009). */
const QuoteForPrintSchema = z
  .object({
    id: z.string(),
    entityId: z.number().int(),
    quoteNo: z.string(),
    createdAt: z.string(),
    validUntil: z.string(),
    placeOfSupplyState: z.string().regex(/^[0-9]{2}$/),
    supplyKind: z.enum(['intra', 'inter']),
    subtotal: money,
    cgst: money,
    sgst: money,
    igst: money,
    roundOff: SignedMoneySchema,
    grandTotal: money,
    customerName: z.string(),
    customerGstin: z.string().nullable(),
    site: z
      .object({
        address: z.string().nullable(),
        village: z.string().nullable(),
        tehsil: z.string().nullable(),
        district: z.string().nullable(),
        pin: z.string().nullable(),
      })
      .strict()
      .nullable(),
    preparedBy: z.string().nullable(),
    lines: z.array(QuotePrintLineSchema).min(1),
  })
  .strict();
export type QuoteForPrint = z.infer<typeof QuoteForPrintSchema>;

/**
 * One quote as the render worker prints it (ADR 0009, docs/design/phase1.md §7.3): read through
 * `app.quote_for_print()`, which only the worker principal (`files.process`) may call and which
 * answers the quote, its lines, the customer's name and GSTIN, the site's address and who made
 * it, never a phone number. A quote outside the request is `not_found`.
 */
export async function loadQuoteForPrint(
  ctx: Pick<RequestContext, 'tx'>,
  quoteId: string,
): Promise<QuoteForPrint> {
  const rows = (await ctx.tx.execute(
    sql`select app.quote_for_print(${quoteId}::uuid) as quote`,
  )) as unknown as { quote: unknown }[];
  const quote = rows[0]?.quote ?? null;
  if (quote === null) {
    throw new DomainError('not_found', `quote ${quoteId} is not visible to the printer`, {
      reason: 'quote_missing',
    });
  }
  return QuoteForPrintSchema.parse(quote);
}
