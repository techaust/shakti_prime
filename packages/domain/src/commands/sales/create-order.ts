import { CreateSalesOrderInput, SalesOrderDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { readSalesOrder } from '../../queries/sales/order-dto';
import { buildDealerOrder } from '../../queries/sales/order-facts';
import { ORDER_AUDIT_FIELDS, saveSalesOrder } from '../../sales/save-order';

/**
 * `sales.order.create` (docs/design/phase1.md §8.3, PRD SAL-06): a dealer's order without a quote,
 * in one company, as a draft. Every price comes from the live list of the dealer's tier for the
 * company or the group, never from the input (SAL-03: the strict input refuses a price), and the
 * tax from the engine; a customer who is not a dealer is refused (`order_needs_accepted_quote`).
 * People only. The insert policy holds the caller to `sales.order.create` over the dealer's
 * relationship in the company.
 */
export const createSalesOrder = defineCommand({
  name: 'sales.order.create',
  permission: 'sales.order.create',
  minScope: 'own',
  peopleOnly: true,
  input: CreateSalesOrderInput,
  output: SalesOrderDto,
  auditFields: [...ORDER_AUDIT_FIELDS],
  constraintReasons: { sales_orders_entity_so_no_unique: 'concurrent_change' },
  async handler(ctx, input) {
    const built = await buildDealerOrder(ctx, input);
    const order = await saveSalesOrder(ctx, {
      entityId: built.dealer.entityId,
      entityCode: built.dealer.entityCode,
      accountId: built.dealer.accountId,
      quoteId: null,
      opportunityId: null,
      siteId: null,
      tierId: built.tier.id,
      priceListId: built.priceListId,
      supply: built.supply,
      lines: built.priced.lines,
      totals: built.priced.totals,
    });
    return readSalesOrder(ctx, built.dealer.entityId, order.id);
  },
});
