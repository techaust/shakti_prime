import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, customerSites } from './accounts';
import { actorsRequired, timestamps } from './columns';
import { commissionRules, referralPartners } from './crm-config';
import { entities } from './entities';
import { items } from './items';
import { kits } from './kits';
import { opportunities } from './opportunities';
import { priceLists, priceTiers } from './pricing';
import { principals } from './principals';
import { quotes } from './quotes';
import { compositeSupplyRules, taxRates } from './tax';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const percent = (name: string) => numeric(name, { precision: 5, scale: 2 });

/** The states an order counts towards a dealer's exposure in: confirmed and not yet paid. */
const COUNTED = sql.raw(`('confirmed', 'partially_dispatched', 'dispatched', 'invoiced')`);

/**
 * A sales order (docs/design/phase1.md §8.3, docs/DATABASE.md §6.4, PRD SAL-06). An order made
 * from an accepted quote is a child of its lead (`opportunity_id`, `quote_id`) and read with it;
 * a dealer's order without a quote has neither and is read by whoever reads the dealer in that
 * company. Its lines, totals, tier, list and place of supply are frozen when it is made; afterwards
 * only its state (through the sales order machine), the credit hold, the Executive's release and
 * the reason it was cancelled change. `so_no` comes from the company's gapless series for the
 * financial year (`app.next_document_no()`).
 */
export const salesOrders = pgTable(
  'sales_orders',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    soNo: text('so_no').notNull(),
    /** The financial year of the series the number came from, `2026-27`. */
    fy: text('fy').notNull(),
    quoteId: uuid('quote_id'),
    opportunityId: uuid('opportunity_id'),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    siteId: uuid('site_id').references(() => customerSites.id),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => priceTiers.id),
    priceListId: uuid('price_list_id').references(() => priceLists.id),
    placeOfSupplyState: text('place_of_supply_state').notNull(),
    supplyKind: text('supply_kind').notNull(),
    state: text('state').notNull().default('draft'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    subtotal: money('subtotal').notNull(),
    cgst: money('cgst').notNull(),
    sgst: money('sgst').notNull(),
    igst: money('igst').notNull(),
    taxTotal: money('tax_total').notNull(),
    roundOff: money('round_off').notNull(),
    grandTotal: money('grand_total').notNull(),
    /** When it was confirmed and by whom; the credit check counts it from then (SALE-5). */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => principals.id),
    /**
     * A confirmation the credit check held (SAL-07): when, which rule (`credit_limit_exceeded`,
     * `credit_overdue` or `credit_limit_missing`) and the facts the sentence names (the limit and
     * the exposure, or the overdue invoice and its days).
     */
    creditHeldAt: timestamp('credit_held_at', { withTimezone: true }),
    creditHoldReason: text('credit_hold_reason'),
    creditHoldJson: jsonb('credit_hold_json'),
    /** The Executive's release of the hold, with the reason (`sales.credit.release`, audited). */
    creditReleaseBy: uuid('credit_release_by').references(() => principals.id),
    creditReleaseReason: text('credit_release_reason'),
    creditReleasedAt: timestamp('credit_released_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('sales_orders_entity_so_no_unique').on(t.entityId, t.soNo),
    // The key the lines and the accruals point at, so they stay in the order's company.
    unique('sales_orders_id_entity_unique').on(t.id, t.entityId),
    // An order of a lead belongs to its lead's company and customer and follows the lead when a
    // customer merge moves it, as its quote does (`app.merge_customers()`).
    foreignKey({
      name: 'sales_orders_opportunity_fk',
      columns: [t.opportunityId, t.entityId, t.accountId],
      foreignColumns: [opportunities.id, opportunities.entityId, opportunities.accountId],
    }).onUpdate('cascade'),
    foreignKey({
      name: 'sales_orders_quote_fk',
      columns: [t.quoteId, t.entityId],
      foreignColumns: [quotes.id, quotes.entityId],
    }),
    // A quote becomes one order.
    uniqueIndex('sales_orders_quote_unique')
      .on(t.quoteId)
      .where(sql`${t.quoteId} is not null`),
    // An order of a quote has its lead; a dealer's order without a quote has neither.
    check(
      'sales_orders_source_check',
      sql`(${t.quoteId} is null) = (${t.opportunityId} is null)`,
    ),
    check(
      'sales_orders_state_check',
      sql`${t.state} in ('draft', 'confirmed', 'partially_dispatched', 'dispatched', 'invoiced', 'closed', 'cancelled')`,
    ),
    check('sales_orders_supply_kind_check', sql`${t.supplyKind} in ('intra', 'inter')`),
    check('sales_orders_place_of_supply_check', sql`${t.placeOfSupplyState} ~ '^[0-9]{2}$'`),
    check(
      'sales_orders_fy_check',
      sql`${t.fy} ~ '^[0-9]{4}-[0-9]{2}$' and right(${t.fy}, 2)::int = (left(${t.fy}, 4)::int + 1) % 100`,
    ),
    check(
      'sales_orders_totals_check',
      sql`${t.subtotal} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0 and ${t.taxTotal} = ${t.cgst} + ${t.sgst} + ${t.igst} and ${t.grandTotal} = ${t.subtotal} + ${t.taxTotal} + ${t.roundOff}`,
    ),
    check('sales_orders_round_off_check', sql`${t.roundOff} between -0.49 and 0.50`),
    // A draft has not been confirmed; an order past it was, and keeps when.
    check(
      'sales_orders_confirmed_check',
      sql`(${t.state} <> 'draft' or (${t.confirmedAt} is null and ${t.confirmedBy} is null))
       and (${t.state} not in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced', 'closed')
            or (${t.confirmedAt} is not null and ${t.confirmedBy} is not null))`,
    ),
    // A hold names its rule and facts; a release names who and why.
    check(
      'sales_orders_credit_hold_check',
      sql`(${t.creditHeldAt} is null) = (${t.creditHoldReason} is null)
       and (${t.creditHeldAt} is null) = (${t.creditHoldJson} is null)
       and (${t.creditHoldReason} is null or ${t.creditHoldReason} in ('credit_limit_exceeded', 'credit_overdue', 'credit_limit_missing'))`,
    ),
    check(
      'sales_orders_credit_hold_json_check',
      sql`${t.creditHoldJson} is null or jsonb_typeof(${t.creditHoldJson}) = 'object'`,
    ),
    check(
      'sales_orders_credit_release_check',
      sql`(${t.creditReleaseBy} is null) = (${t.creditReleaseReason} is null)
       and (${t.creditReleaseBy} is null) = (${t.creditReleasedAt} is null)
       and (${t.creditReleaseReason} is null or length(btrim(${t.creditReleaseReason})) between 1 and 300)`,
    ),
    // A cancelled order says why; no other order carries a reason.
    check(
      'sales_orders_cancel_reason_check',
      sql`(${t.state} = 'cancelled') = (${t.cancelReason} is not null)
       and (${t.cancelReason} is null or length(btrim(${t.cancelReason})) between 1 and 300)`,
    ),
    // `/orders` pages newest first, for one company or every company of the request: read
    // backwards, these serve the list's plain `order by created_at desc, id desc`.
    index('sales_orders_entity_created_idx').on(t.entityId, t.createdAt, t.id),
    index('sales_orders_created_idx').on(t.createdAt, t.id),
    // A lead's orders (the RLS exists on its lead runs the other way, by the lead's key).
    index('sales_orders_opportunity_idx').on(t.opportunityId),
    // Account 360's orders, newest first.
    index('sales_orders_account_idx').on(t.accountId, t.entityId, t.createdAt),
    // A dealer's exposure: the orders confirmed and not yet paid, since a date (SALE-5).
    index('sales_orders_exposure_idx')
      .on(t.entityId, t.accountId, t.confirmedAt)
      .where(sql`${t.state} in ${COUNTED}`),
    index('sales_orders_tier_idx').on(t.tierId),
    index('sales_orders_price_list_idx').on(t.priceListId),
  ],
);

/**
 * One priced line of an order, written with its order and never changed: from a quote, the quote
 * line as it stood (price and tax snapshot, ADR 0007); for a dealer's order, the Price Master
 * price of the dealer's tier and the tax engine's snapshot. Reserved and dispatched quantities
 * arrive with the stock ledger (Phase 3).
 */
export const salesOrderLines = pgTable(
  'sales_order_lines',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    salesOrderId: uuid('sales_order_id').notNull(),
    position: integer('position').notNull(),
    itemId: uuid('item_id').references(() => items.id),
    kitId: uuid('kit_id').references(() => kits.id),
    sku: text('sku').notNull(),
    description: text('description').notNull(),
    unit: text('unit').notNull(),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    unitPrice: money('unit_price').notNull(),
    hsn: text('hsn'),
    worksContract: boolean('works_contract').notNull().default(false),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id),
    taxRatePct: percent('tax_rate_pct'),
    compositeRuleId: uuid('composite_rule_id'),
    goodsRatePct: percent('goods_rate_pct'),
    servicesRatePct: percent('services_rate_pct'),
    taxableValue: money('taxable_value').notNull(),
    goodsTaxable: money('goods_taxable'),
    servicesTaxable: money('services_taxable'),
    cgst: money('cgst').notNull(),
    sgst: money('sgst').notNull(),
    igst: money('igst').notNull(),
    lineTotal: money('line_total').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Named here: the generated name passes Postgres's 63 characters.
    foreignKey({
      name: 'sales_order_lines_composite_rule_fk',
      columns: [t.compositeRuleId],
      foreignColumns: [compositeSupplyRules.id],
    }),
    unique('sales_order_lines_order_position_unique').on(t.salesOrderId, t.position),
    foreignKey({
      name: 'sales_order_lines_order_entity_fk',
      columns: [t.salesOrderId, t.entityId],
      foreignColumns: [salesOrders.id, salesOrders.entityId],
    }),
    check('sales_order_lines_target_check', sql`(${t.itemId} is null) <> (${t.kitId} is null)`),
    check('sales_order_lines_position_check', sql`${t.position} >= 1`),
    check('sales_order_lines_qty_check', sql`${t.qty} > 0`),
    check(
      'sales_order_lines_unit_check',
      sql`${t.unit} in ('nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour')`,
    ),
    check(
      'sales_order_lines_hsn_check',
      sql`${t.hsn} is null or ${t.hsn} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'`,
    ),
    check(
      'sales_order_lines_tax_check',
      sql`(${t.taxRateId} is not null and ${t.taxRatePct} is not null and ${t.compositeRuleId} is null and ${t.goodsRatePct} is null and ${t.servicesRatePct} is null and ${t.goodsTaxable} is null and ${t.servicesTaxable} is null)
       or (${t.taxRateId} is null and ${t.taxRatePct} is null and ${t.compositeRuleId} is not null and ${t.worksContract} and ${t.goodsRatePct} is not null and ${t.servicesRatePct} is not null and ${t.goodsTaxable} is not null and ${t.servicesTaxable} is not null)`,
    ),
    check(
      'sales_order_lines_amounts_check',
      sql`${t.unitPrice} >= 0 and ${t.taxableValue} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0 and ${t.lineTotal} = ${t.taxableValue} + ${t.cgst} + ${t.sgst} + ${t.igst}`,
    ),
    index('sales_order_lines_item_idx').on(t.itemId),
    index('sales_order_lines_kit_idx').on(t.kitId),
  ],
);

/**
 * A dealer's credit terms in one company (SALE-4: limits and days are per company and come from
 * the client), entered by Accounts with `sales.credit.write`. Append-only: each entry is a new
 * row, and the newest counts, so the history of a dealer's terms is its rows. A null limit means
 * no limit is set, which holds every order of the dealer (SAL-07); null days skip the overdue rule.
 */
export const dealerTerms = pgTable(
  'dealer_terms',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    creditLimit: money('credit_limit'),
    creditDays: integer('credit_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    check(
      'dealer_terms_credit_limit_check',
      sql`${t.creditLimit} is null or ${t.creditLimit} >= 0`,
    ),
    check(
      'dealer_terms_credit_days_check',
      sql`${t.creditDays} is null or ${t.creditDays} between 0 and 365`,
    ),
    // A dealer's newest terms in a company, and their history newest first.
    index('dealer_terms_account_idx').on(t.accountId, t.entityId, t.createdAt),
    index('dealer_terms_entity_idx').on(t.entityId),
  ],
);

/**
 * A dealer's outstanding in one company as Accounts entered it by hand (SALE-6), until the Tally
 * sync brings it (Phase 5): the amount, the oldest overdue invoice with its days, and the date it
 * stands at. Append-only; the entry with the newest `as_of` counts (the later entry of one day).
 */
export const dealerOutstanding = pgTable(
  'dealer_outstanding',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    outstanding: money('outstanding').notNull(),
    oldestOverdueDays: integer('oldest_overdue_days'),
    oldestOverdueInvoiceNo: text('oldest_overdue_invoice_no'),
    asOf: date('as_of').notNull(),
    enteredBy: uuid('entered_by')
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('dealer_outstanding_amount_check', sql`${t.outstanding} >= 0`),
    // The block names the invoice (SAL-07): an overdue figure comes with its invoice.
    check(
      'dealer_outstanding_overdue_check',
      sql`(${t.oldestOverdueDays} is null) = (${t.oldestOverdueInvoiceNo} is null)
       and (${t.oldestOverdueDays} is null or ${t.oldestOverdueDays} between 0 and 3650)
       and (${t.oldestOverdueInvoiceNo} is null or length(btrim(${t.oldestOverdueInvoiceNo})) between 1 and 60)`,
    ),
    // A dealer's newest entry in a company, and its history newest first.
    index('dealer_outstanding_account_idx').on(t.accountId, t.entityId, t.asOf, t.createdAt),
    index('dealer_outstanding_entity_idx').on(t.entityId),
  ],
);

/**
 * A referral partner's commission on a confirmed order (CRM-09, CRM-5), worked out by the
 * partner's rule in force on the confirmation date and kept with the rule's basis and rate as they
 * were. Written only through definers (`app.record_commission_accrual()`,
 * `app.cancel_commission_accrual()`), since the person confirming cannot read the rules; read by
 * whoever reads the rules. Append-only apart from the cancel; release on payment is Phase 5.
 */
export const commissionAccruals = pgTable(
  'commission_accruals',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => referralPartners.accountId),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id),
    salesOrderId: uuid('sales_order_id').notNull(),
    commissionRuleId: uuid('commission_rule_id')
      .notNull()
      .references(() => commissionRules.id),
    /** The rule's basis and rate when the commission was worked out. */
    basis: text('basis').notNull(),
    rate: money('rate').notNull(),
    /** What the rate was applied to: the order's taxable value, the lead's kW or HP, or 1. */
    measure: numeric('measure', { precision: 14, scale: 3 }).notNull(),
    amount: money('amount').notNull(),
    state: text('state').notNull().default('accrued'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => principals.id),
  },
  (t) => [
    foreignKey({
      name: 'commission_accruals_order_entity_fk',
      columns: [t.salesOrderId, t.entityId],
      foreignColumns: [salesOrders.id, salesOrders.entityId],
    }),
    // An order earns its partner one commission.
    unique('commission_accruals_order_unique').on(t.salesOrderId),
    check(
      'commission_accruals_basis_check',
      sql`${t.basis} in ('fixed', 'percent', 'per_kw', 'per_hp')`,
    ),
    check('commission_accruals_state_check', sql`${t.state} in ('accrued', 'cancelled')`),
    check(
      'commission_accruals_amounts_check',
      sql`${t.rate} > 0 and ${t.measure} >= 0 and ${t.amount} >= 0`,
    ),
    check(
      'commission_accruals_cancel_check',
      sql`(${t.state} = 'cancelled') = (${t.cancelledAt} is not null)
       and (${t.cancelledAt} is null) = (${t.cancelledBy} is null)`,
    ),
    index('commission_accruals_entity_created_idx').on(t.entityId, t.createdAt),
    index('commission_accruals_partner_idx').on(t.partnerId),
    index('commission_accruals_opportunity_idx').on(t.opportunityId),
    index('commission_accruals_rule_idx').on(t.commissionRuleId),
  ],
);
