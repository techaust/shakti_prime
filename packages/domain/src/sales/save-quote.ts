import { newId } from '@shakti/contracts';
import { schema } from '@shakti/db';
import type { CommandContext } from '../command/context';
import { nextDocumentNo } from '../numbering/next-document-no';
import type { BuiltQuote } from '../queries/sales/quote-facts';

/** The keys a quote's audit rows record besides its ids (`auditFields` of the quote commands). */
export const QUOTE_AUDIT_FIELDS = [
  'quoteNo',
  'state',
  'lineCount',
  'grandTotal',
  'validUntil',
] as const;

/**
 * Numbers and saves a quote `buildQuote()` worked out (docs/03-roadmap-appendix/phase1.md §7.3): the number
 * from the company's gapless series for the financial year (SALE-1, ADR 0006), the quote with its
 * frozen tier, list, place of supply, validity and totals, its lines with their tax snapshot, and
 * its first version. The row takes its `created_at` from the transaction, which is what lets the
 * insert policy of its lines hold them to this transaction. Audits it, sends
 * `sales.quote.created`, and asks the render worker for its PDF (`print.document.requested`).
 * Answers the new quote's id.
 */
export async function saveQuote(
  ctx: CommandContext,
  built: BuiltQuote,
  supersedesId: string | null,
): Promise<string> {
  const { lead, priced } = built;
  const number = await nextDocumentNo(ctx, lead.entityId, lead.entityCode, 'quote');
  const id = newId();
  const sizingId = built.sizing === null ? null : built.sizing.id;
  await ctx.tx.insert(schema.quotes).values({
    id,
    entityId: lead.entityId,
    quoteNo: number.formatted,
    fy: number.fy,
    opportunityId: lead.id,
    accountId: lead.accountId,
    siteId: lead.siteId,
    sizingId,
    tierId: built.tier.id,
    priceListId: built.priceListId,
    scheme: built.scheme,
    placeOfSupplyState: built.supply.stateCode,
    supplyKind: built.supply.kind,
    validUntil: built.validUntil,
    state: 'draft',
    ...priced.totals,
    supersedesId,
    createdBy: ctx.principal.id,
  });
  await ctx.tx.insert(schema.quoteLines).values(
    priced.lines.map((line) => ({
      id: newId(),
      entityId: lead.entityId,
      quoteId: id,
      ...line,
    })),
  );
  await ctx.tx.insert(schema.quoteVersions).values({
    id: newId(),
    entityId: lead.entityId,
    quoteId: id,
    version: 1,
    snapshotJson: {
      quoteNo: number.formatted,
      state: 'draft',
      tierId: built.tier.id,
      priceListId: built.priceListId,
      scheme: built.scheme,
      sizingId,
      placeOfSupply: built.supply,
      validUntil: built.validUntil.toISOString(),
      lines: priced.lines,
      totals: priced.totals,
      supersedesId,
    },
    createdBy: ctx.principal.id,
  });
  ctx.audit({
    aggregateType: 'quote',
    aggregateId: id,
    entityId: lead.entityId,
    after: {
      opportunityId: lead.id,
      quoteNo: number.formatted,
      state: 'draft',
      lineCount: priced.lines.length,
      grandTotal: priced.totals.grandTotal,
      validUntil: built.validUntil.toISOString(),
      priceListId: built.priceListId,
      tierId: built.tier.id,
      supersedesId,
    },
  });
  ctx.emit({
    type: 'sales.quote.created',
    entityId: lead.entityId,
    aggregateType: 'quote',
    aggregateId: id,
    payload: { opportunityId: lead.id, supersedesId, lineCount: priced.lines.length },
  });
  ctx.emit({
    type: 'print.document.requested',
    entityId: lead.entityId,
    aggregateType: 'quote',
    aggregateId: id,
    payload: { documentType: 'quote', documentId: id, version: 1 },
  });
  return id;
}
