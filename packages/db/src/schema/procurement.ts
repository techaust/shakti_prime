import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { items } from './items';
import { principals } from './principals';
import { bins, warehouses } from './stock';
import { taxRates } from './tax';
import { vendorQuotes, vendors } from './vendors';

/** A quantity, in the item's stock unit or its purchase unit as each column says. */
const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/**
 * A reorder rule (docs/03-roadmap-appendix/phase3.md §7.2): when a company's free stock of an
 * item at a hub, with what open purchase orders still bring, falls below `reorder_level`, the
 * reorder job drafts `reorder_qty` from the item's preferred vendor. Both in the stock unit.
 */
export const reorderRules = pgTable(
  'reorder_rules',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    reorderLevel: quantity('reorder_level').notNull(),
    reorderQty: quantity('reorder_qty').notNull(),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('reorder_rules_entity_item_hub_unique').on(t.entityId, t.itemId, t.warehouseId),
    check('reorder_rules_level_check', sql`${t.reorderLevel} >= 0`),
    check('reorder_rules_qty_check', sql`${t.reorderQty} > 0`),
    index('reorder_rules_item_idx').on(t.itemId),
    index('reorder_rules_warehouse_idx').on(t.warehouseId),
  ],
);

/**
 * A purchase order of one company to one vendor, delivered to one hub (§7.2). Its state is the
 * `purchase_order` machine's. The vendor's state code and the place of supply are kept for the tax
 * split; no rate or amount lives here (`po_line_rates`, behind `procurement.rate.read`).
 * `drafted_by` is the person who last wrote the draft, or the platform for a reorder draft no
 * person has edited: nobody but an Executive approves an order they drafted.
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    poNo: text('po_no').notNull(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    deliverToWarehouseId: uuid('deliver_to_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    state: text('state').notNull().default('draft'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** `manual` (a person made it) or `reorder` (the reorder job drafted it). */
    source: text('source').notNull().default('manual'),
    expectedAt: date('expected_at'),
    draftedBy: uuid('drafted_by')
      .notNull()
      .references(() => principals.id),
    approvedBy: uuid('approved_by').references(() => principals.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** `email` (the PDF through the mailer) or `by_hand` (marked sent by a person). */
    sentVia: text('sent_via'),
    cancelReason: text('cancel_reason'),
    closeReason: text('close_reason'),
    /** The vendor's GST state when the order was last written; null for an unregistered vendor. */
    vendorStateCode: text('vendor_state_code'),
    /** Where the goods are delivered: the hub's state. */
    placeOfSupplyStateCode: text('place_of_supply_state_code').notNull(),
    notes: text('notes'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('purchase_orders_entity_no_unique').on(t.entityId, t.poNo),
    unique('purchase_orders_id_entity_unique').on(t.id, t.entityId),
    check(
      'purchase_orders_state_check',
      sql`${t.state} in ('draft', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled')`,
    ),
    check('purchase_orders_source_check', sql`${t.source} in ('manual', 'reorder')`),
    check(
      'purchase_orders_sent_via_check',
      sql`${t.sentVia} is null or ${t.sentVia} in ('email', 'by_hand')`,
    ),
    check(
      'purchase_orders_approved_check',
      sql`(${t.approvedBy} is null) = (${t.approvedAt} is null)
          and (${t.state} in ('draft') or ${t.state} = 'cancelled' or ${t.approvedAt} is not null)`,
    ),
    check(
      'purchase_orders_sent_check',
      sql`(${t.sentAt} is null) = (${t.sentVia} is null)
          and (${t.state} not in ('sent', 'partially_received', 'received') or ${t.sentAt} is not null)`,
    ),
    check(
      'purchase_orders_cancel_check',
      sql`(${t.state} = 'cancelled') = (${t.cancelReason} is not null)
          and (${t.cancelReason} is null or char_length(${t.cancelReason}) between 1 and 300)`,
    ),
    check(
      'purchase_orders_close_check',
      sql`(${t.closeReason} is null or ${t.state} = 'closed')
          and (${t.closeReason} is null or char_length(${t.closeReason}) between 1 and 300)`,
    ),
    check(
      'purchase_orders_state_codes_check',
      sql`(${t.vendorStateCode} is null or ${t.vendorStateCode} ~ '^[0-9]{2}$')
          and ${t.placeOfSupplyStateCode} ~ '^[0-9]{2}$'`,
    ),
    check(
      'purchase_orders_notes_check',
      sql`${t.notes} is null or char_length(${t.notes}) between 1 and 1000`,
    ),
    // The orders list pages by state, newest first, per company.
    index('purchase_orders_entity_state_idx').on(t.entityId, t.state, t.createdAt, t.id),
    index('purchase_orders_vendor_idx').on(t.vendorId),
    index('purchase_orders_warehouse_idx').on(t.deliverToWarehouseId),
  ],
);

/**
 * A line of a purchase order: one item, in its purchase unit, with the stock units each purchase
 * unit holds (`unit_factor`, from the item when the line was written), the quantity received so
 * far, and the GST rate the tax engine resolved for its HSN. Its rate is `po_line_rates`.
 */
export const poLines = pgTable(
  'po_lines',
  {
    id: uuid('id').primaryKey(),
    poId: uuid('po_id').notNull(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    qty: quantity('qty').notNull(),
    purchaseUnit: text('purchase_unit').notNull(),
    unitFactor: quantity('unit_factor').notNull(),
    qtyReceived: quantity('qty_received').notNull().default('0'),
    hsn: text('hsn').notNull(),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id),
    taxRatePct: numeric('tax_rate_pct', { precision: 5, scale: 2 }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    foreignKey({
      name: 'po_lines_po_fk',
      columns: [t.poId, t.entityId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.entityId],
    }),
    unique('po_lines_id_entity_unique').on(t.id, t.entityId),
    unique('po_lines_po_item_unique').on(t.poId, t.itemId),
    unique('po_lines_po_line_no_unique').on(t.poId, t.lineNo),
    check('po_lines_line_no_check', sql`${t.lineNo} between 1 and 200`),
    check('po_lines_qty_check', sql`${t.qty} > 0`),
    check('po_lines_factor_check', sql`${t.unitFactor} >= 1`),
    check(
      'po_lines_received_check',
      sql`${t.qtyReceived} >= 0 and ${t.qtyReceived} <= ${t.qty}`,
    ),
    check('po_lines_hsn_check', sql`${t.hsn} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'`),
    check(
      'po_lines_tax_rate_check',
      sql`(${t.taxRateId} is null) = (${t.taxRatePct} is null)
          and (${t.taxRatePct} is null or ${t.taxRatePct} between 0 and 100)`,
    ),
    index('po_lines_item_idx').on(t.itemId),
  ],
);

/**
 * A purchase order line's rate and amount (restricted, docs/05-database.md §4.3): read only with
 * `procurement.rate.read` in the line's company, as `vendor_quotes` are. `unit_rate` is per
 * purchase unit excluding GST; `amount` is the quantity times the rate, rounded to the paisa.
 * `quote_id` names the supplier quote the rate was filled from, if any.
 */
export const poLineRates = pgTable(
  'po_line_rates',
  {
    poLineId: uuid('po_line_id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    unitRate: numeric('unit_rate', { precision: 14, scale: 4 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    quoteId: uuid('quote_id').references(() => vendorQuotes.id),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    foreignKey({
      name: 'po_line_rates_line_fk',
      columns: [t.poLineId, t.entityId],
      foreignColumns: [poLines.id, poLines.entityId],
    }).onDelete('cascade'),
    check('po_line_rates_rate_check', sql`${t.unitRate} > 0`),
    check('po_line_rates_amount_check', sql`${t.amount} >= 0`),
    index('po_line_rates_quote_idx').on(t.quoteId),
  ],
);

/**
 * A goods receipt against one purchase order, into one hub (§7.2), numbered from the
 * `goods_receipt` series. Posted once; reversed whole while none of its stock or serials has moved
 * on (`procurement.grn.reverse`).
 */
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    grnNo: text('grn_no').notNull(),
    poId: uuid('po_id').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    state: text('state').notNull().default('posted'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    receivedBy: uuid('received_by')
      .notNull()
      .references(() => principals.id),
    vendorInvoiceNo: text('vendor_invoice_no'),
    vendorInvoiceDate: date('vendor_invoice_date'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedBy: uuid('reversed_by').references(() => principals.id),
    reverseReason: text('reverse_reason'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    foreignKey({
      name: 'goods_receipts_po_fk',
      columns: [t.poId, t.entityId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.entityId],
    }),
    unique('goods_receipts_entity_no_unique').on(t.entityId, t.grnNo),
    unique('goods_receipts_id_entity_unique').on(t.id, t.entityId),
    check('goods_receipts_state_check', sql`${t.state} in ('posted', 'reversed')`),
    check(
      'goods_receipts_reversed_check',
      sql`(${t.state} = 'reversed') = (${t.reversedAt} is not null)
          and (${t.reversedAt} is null) = (${t.reversedBy} is null)
          and (${t.reversedAt} is null) = (${t.reverseReason} is null)
          and (${t.reverseReason} is null or char_length(${t.reverseReason}) between 1 and 300)`,
    ),
    check(
      'goods_receipts_invoice_check',
      sql`${t.vendorInvoiceNo} is null or char_length(${t.vendorInvoiceNo}) between 1 and 40`,
    ),
    // The receipts list pages by company, newest first; an order's receipts by order.
    index('goods_receipts_entity_received_idx').on(t.entityId, t.receivedAt, t.id),
    index('goods_receipts_po_idx').on(t.poId),
    index('goods_receipts_warehouse_idx').on(t.warehouseId),
  ],
);

/**
 * A line of a goods receipt: what of one purchase order line came in, into which bin (the hub's
 * receiving bin unless the person chose another), in the purchase unit (`qty`) and the stock unit
 * (`stock_qty`). A serial-tracked item's serials name the line (`serials.receipt_line_id`).
 */
export const goodsReceiptLines = pgTable(
  'goods_receipt_lines',
  {
    id: uuid('id').primaryKey(),
    receiptId: uuid('receipt_id').notNull(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    poLineId: uuid('po_line_id').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    binId: uuid('bin_id')
      .notNull()
      .references(() => bins.id),
    qty: quantity('qty').notNull(),
    stockQty: quantity('stock_qty').notNull(),
    isSerialTracked: boolean('is_serial_tracked').notNull(),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    foreignKey({
      name: 'goods_receipt_lines_receipt_fk',
      columns: [t.receiptId, t.entityId],
      foreignColumns: [goodsReceipts.id, goodsReceipts.entityId],
    }),
    foreignKey({
      name: 'goods_receipt_lines_po_line_fk',
      columns: [t.poLineId, t.entityId],
      foreignColumns: [poLines.id, poLines.entityId],
    }),
    unique('goods_receipt_lines_id_entity_unique').on(t.id, t.entityId),
    unique('goods_receipt_lines_receipt_po_line_unique').on(t.receiptId, t.poLineId),
    check('goods_receipt_lines_qty_check', sql`${t.qty} > 0 and ${t.stockQty} > 0`),
    index('goods_receipt_lines_po_line_idx').on(t.poLineId),
    index('goods_receipt_lines_item_idx').on(t.itemId),
    index('goods_receipt_lines_bin_idx').on(t.binId),
  ],
);

/**
 * A goods receipt line's rate (restricted, as `po_line_rates`): the purchase order line's rate per
 * purchase unit when the goods came in, which the ledger takes as the receipt's cost. Written only
 * by the receipt definer; read only with `procurement.rate.read`.
 */
export const goodsReceiptLineRates = pgTable(
  'goods_receipt_line_rates',
  {
    receiptLineId: uuid('receipt_line_id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    unitRate: numeric('unit_rate', { precision: 14, scale: 4 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'goods_receipt_line_rates_line_fk',
      columns: [t.receiptLineId, t.entityId],
      foreignColumns: [goodsReceiptLines.id, goodsReceiptLines.entityId],
    }),
    check('goods_receipt_line_rates_rate_check', sql`${t.unitRate} > 0`),
  ],
);
