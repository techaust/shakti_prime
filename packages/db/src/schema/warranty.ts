import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
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
import { entities } from './entities';
import { items } from './items';
import { serials } from './stock';
import { vendors } from './vendors';

/**
 * A warranty claim and its supplier return (R3, docs/03-roadmap-appendix/phase3.md §7.5, PRD
 * INV-08): the five steps of BLUEPRINT §8.4, the `warranty_claim` machine's state. A claim belongs
 * to one company and one customer; its serials are that company's serials of the claim's item
 * (composite foreign keys), so the failed serial, its replacement from stock and the supplier's
 * replacement are all the same product. The costs live in `warranty_claim_costs`, restricted.
 */
export const warrantyClaims = pgTable(
  'warranty_claims',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    /** From the `warranty_claim` series (`WC`). */
    claimNo: text('claim_no').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    siteId: uuid('site_id').references(() => customerSites.id),
    /** The failed product, known once the serial is (or from the serial it was raised on). */
    itemId: uuid('item_id').references(() => items.id),
    serialId: uuid('serial_id'),
    reportedFault: text('reported_fault').notNull(),
    state: text('state').notNull(),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    replacementSerialId: uuid('replacement_serial_id'),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    supplierRmaRef: text('supplier_rma_ref'),
    settlement: text('settlement'),
    /** The supplier's replacement serial, received into stock at settlement. */
    supplierSerialId: uuid('supplier_serial_id'),
    rejectedReason: text('rejected_reason'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('warranty_claims_entity_claim_no_unique').on(t.entityId, t.claimNo),
    unique('warranty_claims_id_entity_unique').on(t.id, t.entityId),
    foreignKey({
      name: 'warranty_claims_serial_fk',
      columns: [t.serialId, t.entityId, t.itemId],
      foreignColumns: [serials.id, serials.entityId, serials.itemId],
    }),
    foreignKey({
      name: 'warranty_claims_replacement_serial_fk',
      columns: [t.replacementSerialId, t.entityId, t.itemId],
      foreignColumns: [serials.id, serials.entityId, serials.itemId],
    }),
    foreignKey({
      name: 'warranty_claims_supplier_serial_fk',
      columns: [t.supplierSerialId, t.entityId, t.itemId],
      foreignColumns: [serials.id, serials.entityId, serials.itemId],
    }),
    check(
      'warranty_claims_state_check',
      sql`${t.state} in ('raised', 'serial_identified', 'replacement_issued', 'rma_raised', 'closed', 'rejected')`,
    ),
    check('warranty_claims_settlement_check', sql`${t.settlement} in ('credit', 'replacement')`),
    check(
      'warranty_claims_reported_fault_check',
      sql`char_length(btrim(${t.reportedFault})) between 1 and 1000`,
    ),
    check(
      'warranty_claims_rma_ref_check',
      sql`${t.supplierRmaRef} is null or char_length(btrim(${t.supplierRmaRef})) between 1 and 100`,
    ),
    check(
      'warranty_claims_rejected_reason_check',
      sql`${t.rejectedReason} is null or char_length(btrim(${t.rejectedReason})) between 1 and 300`,
    ),
    // A serial names its product, so each serial key checks against the claim's item.
    check(
      'warranty_claims_item_check',
      sql`(${t.serialId} is null and ${t.replacementSerialId} is null and ${t.supplierSerialId} is null)
          or ${t.itemId} is not null`,
    ),
    // Each step keeps what its machine guard asked for.
    check(
      'warranty_claims_steps_check',
      sql`(${t.state} in ('raised', 'rejected') or ${t.serialId} is not null)
          and (${t.state} not in ('replacement_issued', 'rma_raised', 'closed') or ${t.replacementSerialId} is not null)
          and (${t.state} not in ('rma_raised', 'closed') or (${t.vendorId} is not null and ${t.supplierRmaRef} is not null))
          and ((${t.state} = 'closed') = (${t.settlement} is not null))
          and ((${t.state} = 'rejected') = (${t.rejectedReason} is not null))
          and ((${t.settlement} = 'replacement') = (${t.supplierSerialId} is not null))`,
    ),
    check(
      'warranty_claims_serials_differ_check',
      sql`(${t.replacementSerialId} is null or ${t.replacementSerialId} <> ${t.serialId})
          and (${t.supplierSerialId} is null
               or (${t.supplierSerialId} <> ${t.serialId} and ${t.supplierSerialId} <> ${t.replacementSerialId}))`,
    ),
    // One open claim per failed serial.
    uniqueIndex('warranty_claims_open_serial_unique')
      .on(t.serialId)
      .where(sql`${t.serialId} is not null and ${t.state} not in ('closed', 'rejected')`),
    // The list by state, newest first.
    index('warranty_claims_list_idx').on(t.entityId, t.state, t.createdAt.desc(), t.id.desc()),
    index('warranty_claims_account_idx').on(t.accountId),
    index('warranty_claims_serial_idx')
      .on(t.serialId)
      .where(sql`${t.serialId} is not null`),
    index('warranty_claims_replacement_serial_idx')
      .on(t.replacementSerialId)
      .where(sql`${t.replacementSerialId} is not null`),
    index('warranty_claims_supplier_serial_idx')
      .on(t.supplierSerialId)
      .where(sql`${t.supplierSerialId} is not null`),
    index('warranty_claims_vendor_idx')
      .on(t.vendorId)
      .where(sql`${t.vendorId} is not null`),
    index('warranty_claims_site_idx')
      .on(t.siteId)
      .where(sql`${t.siteId} is not null`),
  ],
);

/**
 * A claim's costs (restricted, `finance.cost.read`; question 10 (a)): the replacement's cost at
 * the moving average it left stock at, and the supplier's credit. The restricted side table of
 * `stock_movement_costs`, so the claim itself stays readable by the inventory roles. Written only
 * by the definers `app.warranty_claim_record_cost()` and `app.warranty_claim_record_credit()`;
 * Phase 5 turns each into a job cost entry.
 */
export const warrantyClaimCosts = pgTable(
  'warranty_claim_costs',
  {
    claimId: uuid('claim_id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    replacementCost: numeric('replacement_cost', { precision: 14, scale: 2 }),
    supplierCreditAmount: numeric('supplier_credit_amount', { precision: 14, scale: 2 }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'warranty_claim_costs_claim_fk',
      columns: [t.claimId, t.entityId],
      foreignColumns: [warrantyClaims.id, warrantyClaims.entityId],
    }),
    check(
      'warranty_claim_costs_replacement_cost_check',
      sql`${t.replacementCost} is null or ${t.replacementCost} >= 0`,
    ),
    check(
      'warranty_claim_costs_credit_check',
      sql`${t.supplierCreditAmount} is null or ${t.supplierCreditAmount} > 0`,
    ),
  ],
);
