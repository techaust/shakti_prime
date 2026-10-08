import {
  newId,
  type PlaceOfSupply,
  type QuoteLineDto,
  type QuoteTotalsDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import type { CommandContext } from '../command/context';
import { nextDocumentNo } from '../numbering/next-document-no';

/** The keys an order's audit rows record besides its ids (`auditFields` of the order commands). */
export const ORDER_AUDIT_FIELDS = [
  'soNo',
  'orderState',
  'lineCount',
  'grandTotal',
  'creditHoldReason',
  'creditReleaseReason',
  'cancelReason',
  'released',
  'commissionState',
] as const;

/** Everything an order is made from, worked out and checked, before it is numbered and saved. */
export interface OrderToSave {
  entityId: number;
  entityCode: string;
  accountId: string;
  /** For an order of an accepted quote: the quote and its lead; null for a dealer's own order. */
  quoteId: string | null;
  opportunityId: string | null;
  siteId: string | null;
  tierId: string;
  priceListId: string | null;
  supply: Pick<PlaceOfSupply, 'stateCode' | 'kind'>;
  lines: readonly QuoteLineDto[];
  totals: QuoteTotalsDto;
}

/**
 * Numbers and saves a draft order (docs/03-roadmap-appendix/phase1.md §8.3): the number from the company's
 * gapless series for the financial year (SALE-1), the order with its frozen tier, list, place of
 * supply and totals, and its lines with their tax snapshot. The row takes its `created_at` from
 * the transaction, which is what lets the insert policy of its lines hold them to this
 * transaction. Audits it and sends `sales.order.created`. Answers the new order's id and number.
 */
export async function saveSalesOrder(
  ctx: CommandContext,
  order: OrderToSave,
): Promise<{ id: string; soNo: string }> {
  const number = await nextDocumentNo(ctx, order.entityId, order.entityCode, 'sales_order');
  const id = newId();
  await ctx.tx.insert(schema.salesOrders).values({
    id,
    entityId: order.entityId,
    soNo: number.formatted,
    fy: number.fy,
    quoteId: order.quoteId,
    opportunityId: order.opportunityId,
    accountId: order.accountId,
    siteId: order.siteId,
    tierId: order.tierId,
    priceListId: order.priceListId,
    placeOfSupplyState: order.supply.stateCode,
    supplyKind: order.supply.kind,
    state: 'draft',
    ...order.totals,
    createdBy: ctx.principal.id,
  });
  await ctx.tx.insert(schema.salesOrderLines).values(
    order.lines.map((line) => ({
      id: newId(),
      entityId: order.entityId,
      salesOrderId: id,
      ...line,
    })),
  );
  ctx.audit({
    aggregateType: 'sales_order',
    aggregateId: id,
    entityId: order.entityId,
    after: {
      soNo: number.formatted,
      orderState: 'draft',
      quoteId: order.quoteId,
      opportunityId: order.opportunityId,
      accountId: order.accountId,
      tierId: order.tierId,
      priceListId: order.priceListId,
      lineCount: order.lines.length,
      grandTotal: order.totals.grandTotal,
    },
  });
  ctx.emit({
    type: 'sales.order.created',
    entityId: order.entityId,
    aggregateType: 'sales_order',
    aggregateId: id,
    payload: {
      accountId: order.accountId,
      quoteId: order.quoteId,
      opportunityId: order.opportunityId,
      lineCount: order.lines.length,
    },
  });
  return { id, soNo: number.formatted };
}
