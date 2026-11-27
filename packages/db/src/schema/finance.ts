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
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { files } from './files';
import { principals } from './principals';
import { salesOrderLines, salesOrders } from './sales-orders';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const percent = (name: string) => numeric(name, { precision: 5, scale: 2 });

const SEGMENTS = sql.raw(
  `('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale')`,
);
const DUE_RULES = sql.raw(
  `('on_confirmation', 'before_dispatch', 'on_installation', 'days_after_invoice')`,
);

/**
 * A proforma (docs/03-roadmap-appendix/phase5.md §5, §6.1, question 3 (a)): the BOS's one document
 * asking for payment, issued from a confirmed order with `finance.proforma.write`. Its place of
 * supply and totals are the order's, copied when it is issued and never worked out again; its
 * number comes from the company's gapless `proforma` series for the financial year
 * (`app.next_document_no()`). Afterwards only its PDF and its cancellation change; a cancelled
 * proforma keeps its number. One proforma of an order is live at a time.
 */
export const proformas = pgTable(
  'proformas',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    proformaNo: text('proforma_no').notNull(),
    /** The financial year of the series the number came from, `2026-27`. */
    fy: text('fy').notNull(),
    salesOrderId: uuid('sales_order_id').notNull(),
    state: text('state').notNull().default('issued'),
    placeOfSupplyState: text('place_of_supply_state').notNull(),
    supplyKind: text('supply_kind').notNull(),
    subtotal: money('subtotal').notNull(),
    cgst: money('cgst').notNull(),
    sgst: money('sgst').notNull(),
    igst: money('igst').notNull(),
    taxTotal: money('tax_total').notNull(),
    roundOff: money('round_off').notNull(),
    grandTotal: money('grand_total').notNull(),
    pdfFileId: uuid('pdf_file_id').references(() => files.id),
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => principals.id),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('proformas_entity_no_unique').on(t.entityId, t.proformaNo),
    // The key the lines point at, so they stay in the proforma's company.
    unique('proformas_id_entity_unique').on(t.id, t.entityId),
    foreignKey({
      name: 'proformas_order_entity_fk',
      columns: [t.salesOrderId, t.entityId],
      foreignColumns: [salesOrders.id, salesOrders.entityId],
    }),
    // One live proforma of an order; a cancelled one stays beside the next.
    uniqueIndex('proformas_order_live_unique')
      .on(t.salesOrderId)
      .where(sql`${t.state} = 'issued'`),
    // An order's proformas, newest first (the Payments tab).
    index('proformas_order_idx').on(t.salesOrderId, t.createdAt),
    index('proformas_pdf_file_idx').on(t.pdfFileId),
    check('proformas_state_check', sql`${t.state} in ('issued', 'cancelled')`),
    check('proformas_supply_kind_check', sql`${t.supplyKind} in ('intra', 'inter')`),
    check('proformas_place_of_supply_check', sql`${t.placeOfSupplyState} ~ '^[0-9]{2}$'`),
    check(
      'proformas_fy_check',
      sql`${t.fy} ~ '^[0-9]{4}-[0-9]{2}$' and right(${t.fy}, 2)::int = (left(${t.fy}, 4)::int + 1) % 100`,
    ),
    check(
      'proformas_totals_check',
      sql`${t.subtotal} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0 and ${t.taxTotal} = ${t.cgst} + ${t.sgst} + ${t.igst} and ${t.grandTotal} = ${t.subtotal} + ${t.taxTotal} + ${t.roundOff}`,
    ),
    check(
      'proformas_gst_split_check',
      sql`(${t.supplyKind} = 'intra' and ${t.igst} = 0) or (${t.supplyKind} = 'inter' and ${t.cgst} = 0 and ${t.sgst} = 0)`,
    ),
    check('proformas_round_off_check', sql`${t.roundOff} between -0.49 and 0.50`),
    // A cancelled proforma says when, by whom and why; an issued one carries none of them.
    check(
      'proformas_cancel_check',
      sql`(${t.state} = 'cancelled') = (${t.cancelReason} is not null)
       and (${t.cancelReason} is null) = (${t.cancelledAt} is null)
       and (${t.cancelReason} is null) = (${t.cancelledBy} is null)
       and (${t.cancelReason} is null or length(btrim(${t.cancelReason})) between 1 and 300)`,
    ),
  ],
);

/**
 * One line of a proforma: its order's line as it stands, copied whole (the item, the price, the
 * HSN code, the tax rate or composite rule and the tax split), so a later change of a price or a
 * rate never reaches an issued proforma. Written with its proforma and never changed.
 */
export const proformaLines = pgTable(
  'proforma_lines',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    proformaId: uuid('proforma_id').notNull(),
    salesOrderLineId: uuid('sales_order_line_id').notNull(),
    position: integer('position').notNull(),
    // Copies of the order line's values; the order line keeps their references.
    itemId: uuid('item_id'),
    kitId: uuid('kit_id'),
    sku: text('sku').notNull(),
    description: text('description').notNull(),
    unit: text('unit').notNull(),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    unitPrice: money('unit_price').notNull(),
    hsn: text('hsn'),
    worksContract: boolean('works_contract').notNull().default(false),
    taxRateId: uuid('tax_rate_id'),
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
    foreignKey({
      name: 'proforma_lines_proforma_entity_fk',
      columns: [t.proformaId, t.entityId],
      foreignColumns: [proformas.id, proformas.entityId],
    }),
    foreignKey({
      name: 'proforma_lines_order_line_fk',
      columns: [t.salesOrderLineId],
      foreignColumns: [salesOrderLines.id],
    }),
    unique('proforma_lines_proforma_position_unique').on(t.proformaId, t.position),
    index('proforma_lines_order_line_idx').on(t.salesOrderLineId),
    check('proforma_lines_position_check', sql`${t.position} >= 1`),
    check('proforma_lines_qty_check', sql`${t.qty} > 0`),
    check(
      'proforma_lines_amounts_check',
      sql`${t.unitPrice} >= 0 and ${t.taxableValue} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0 and ${t.lineTotal} = ${t.taxableValue} + ${t.cgst} + ${t.sgst} + ${t.igst}`,
    ),
  ],
);

/**
 * A company's payment terms for a segment (question 6 (a)): the steps an order of that segment is
 * paid in, as an Executive published them (`finance.payment.write` for every company). Versioned:
 * a change is a new version, the newest is current, and an order keeps the version it was planned
 * from. The steps are checked by their contract (`MilestoneStepsSchema`). Never changed.
 */
export const paymentMilestoneTemplates = pgTable(
  'payment_milestone_templates',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    segment: text('segment').notNull(),
    version: integer('version').notNull(),
    stepsJson: jsonb('steps_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'payment_milestone_templates_created_by_fk',
      columns: [t.createdBy],
      foreignColumns: [principals.id],
    }),
    // Also the current version's lookup: the newest of a company's segment.
    unique('payment_milestone_templates_version_unique').on(t.entityId, t.segment, t.version),
    check('payment_milestone_templates_segment_check', sql`${t.segment} in ${SEGMENTS}`),
    check('payment_milestone_templates_version_check', sql`${t.version} >= 1`),
    check(
      'payment_milestone_templates_steps_check',
      sql`jsonb_typeof(${t.stepsJson}) = 'array' and jsonb_array_length(${t.stepsJson}) between 1 and 10`,
    ),
  ],
);

/**
 * One payment milestone of an order (docs/03-roadmap-appendix/phase5.md §5): its step of the terms
 * (key, label, share, due rule, loan gate) and its amount, planned once from the company's current
 * terms for the order's segment, or the named default when it has none. The amounts of an order's
 * milestones sum to its total. Written only through `app.record_order_milestones()`; afterwards a
 * person changes only a waiver (the Executive), and the payments of Tally receipts move it on
 * (TC3).
 */
export const paymentMilestones = pgTable(
  'payment_milestones',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    salesOrderId: uuid('sales_order_id').notNull(),
    /** The version of the terms it was planned from; null for the named default. */
    templateId: uuid('template_id'),
    seq: smallint('seq').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** The step's share of the order's total; null for a fixed amount. */
    percent: percent('percent'),
    amount: money('amount').notNull(),
    paidAmount: money('paid_amount').notNull().default('0'),
    dueRule: text('due_rule').notNull(),
    dueDays: smallint('due_days'),
    loanGate: text('loan_gate').notNull().default('none'),
    state: text('state').notNull(),
    /** The day it fell due (IST); null while it waits. */
    dueOn: date('due_on'),
    waivedAt: timestamp('waived_at', { withTimezone: true }),
    waivedBy: uuid('waived_by').references(() => principals.id),
    waiveReason: text('waive_reason'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    foreignKey({
      name: 'payment_milestones_order_entity_fk',
      columns: [t.salesOrderId, t.entityId],
      foreignColumns: [salesOrders.id, salesOrders.entityId],
    }),
    // An order's milestones in order; also the dispatch gate's lookup.
    unique('payment_milestones_order_seq_unique').on(t.salesOrderId, t.seq),
    // A loan names a milestone by its key.
    unique('payment_milestones_order_key_unique').on(t.salesOrderId, t.key),
    // Named here: the generated name passes Postgres's 63 characters.
    foreignKey({
      name: 'payment_milestones_template_fk',
      columns: [t.templateId],
      foreignColumns: [paymentMilestoneTemplates.id],
    }),
    index('payment_milestones_template_idx').on(t.templateId),
    check('payment_milestones_seq_check', sql`${t.seq} between 1 and 10`),
    check('payment_milestones_key_check', sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      'payment_milestones_label_check',
      sql`length(btrim(${t.label})) between 2 and 60`,
    ),
    check('payment_milestones_percent_check', sql`${t.percent} is null or ${t.percent} > 0`),
    check(
      'payment_milestones_amounts_check',
      sql`${t.amount} >= 0 and ${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.amount}`,
    ),
    check('payment_milestones_due_rule_check', sql`${t.dueRule} in ${DUE_RULES}`),
    check(
      'payment_milestones_due_days_check',
      sql`(${t.dueRule} = 'days_after_invoice') = (${t.dueDays} is not null)
       and (${t.dueDays} is null or ${t.dueDays} between 1 and 365)`,
    ),
    check('payment_milestones_loan_gate_check', sql`${t.loanGate} in ('none', 'customer_loan')`),
    check(
      'payment_milestones_state_check',
      sql`${t.state} in ('pending', 'due', 'part_paid', 'paid', 'waived')`,
    ),
    // What is paid matches the state: nothing while it waits or is due, part of it, or all of it.
    check(
      'payment_milestones_paid_check',
      sql`(${t.state} not in ('pending', 'due') or ${t.paidAmount} = 0)
       and (${t.state} <> 'part_paid' or (${t.paidAmount} > 0 and ${t.paidAmount} < ${t.amount}))
       and (${t.state} <> 'paid' or ${t.paidAmount} = ${t.amount})`,
    ),
    check('payment_milestones_due_on_check', sql`${t.state} <> 'due' or ${t.dueOn} is not null`),
    // A waived milestone says when, by whom and why; no other carries a waiver.
    check(
      'payment_milestones_waive_check',
      sql`(${t.state} = 'waived') = (${t.waivedAt} is not null)
       and (${t.waivedAt} is null) = (${t.waivedBy} is null)
       and (${t.waivedAt} is null) = (${t.waiveReason} is null)
       and (${t.waiveReason} is null or length(btrim(${t.waiveReason})) between 1 and 300)`,
    ),
  ],
);
