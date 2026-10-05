import { CreateQuoteInput, QuoteDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { buildQuote } from '../../queries/sales/quote-facts';
import { readQuote } from '../../queries/sales/quote-dto';
import { QUOTE_AUDIT_FIELDS, saveQuote } from './quote-shared';

/**
 * `sales.quote.create` (docs/design/phase1.md §7.3, PRD SAL-03, SAL-04): a quote for a lead. The
 * tier is the customer's (PRICE-1), every price comes from the live list of that tier for the
 * lead's company or the group, and a line that carries a price is refused by the strict input
 * (SAL-03). Tax comes from the tax engine with each line's rate row, the composite split for a
 * works contract in a composite segment, and the place of supply from the site (ADR 0007). The
 * quote is valid for the workshop default 15 days and numbered from the company's series. It is
 * refused when the customer has no tier, no list is live for it, or the lead's sizing is missing
 * or out of bounds, the pump is off its curve or the DCR rule fails (the quote machine's `create`
 * guards over C4's sizing facts). The insert policy holds the caller to `sales.quote.create` over
 * the lead's owner and team. The PDF is rendered after commit by the render worker.
 */
export const createQuote = defineCommand({
  name: 'sales.quote.create',
  permission: 'sales.quote.create',
  minScope: 'own',
  input: CreateQuoteInput,
  output: QuoteDto,
  auditFields: [...QUOTE_AUDIT_FIELDS],
  constraintReasons: { quotes_entity_quote_no_unique: 'concurrent_change' },
  async handler(ctx, input) {
    const built = await buildQuote(ctx, input);
    const id = await saveQuote(ctx, built, null);
    return readQuote(ctx, built.lead.entityId, id);
  },
});
