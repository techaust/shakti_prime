import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
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
import { items } from './items';
import { principals } from './principals';

/**
 * The group's vendor master (docs/03-roadmap-appendix/phase3.md §6.3, question 6 (a)): one list
 * for every company, as customers are shared (ADR 0008), so a vendor carries no company. Read by a
 * holder of `inventory.stock.read` or `procurement.po.write` acting in any company, written by a
 * holder of `procurement.po.write` through the procurement commands. No rate lives here: a
 * supplier's rates are `vendor_quotes`, behind `procurement.rate.read`.
 */
export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /** Null for a supplier without GST registration; unique where set (the import's key). */
    gstin: text('gstin'),
    /** The supplier's GST state; the GSTIN starts with it when one is recorded. */
    stateCode: text('state_code'),
    pan: text('pan'),
    /** `{ line1, line2?, city, pin? }` as the vendor sheet takes it; always an object. */
    addressJson: jsonb('address_json').notNull().default({}),
    paymentTermsDays: smallint('payment_terms_days'),
    leadTimeDays: smallint('lead_time_days'),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('vendors_name_check', sql`length(btrim(${t.name})) between 2 and 160`),
    // The entities' GSTIN check (`entities_gstin_check`), and its first two digits are the state.
    check(
      'vendors_gstin_check',
      sql`${t.gstin} is null or (${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
          and ${t.stateCode} = left(${t.gstin}, 2))`,
    ),
    check('vendors_state_code_check', sql`${t.stateCode} is null or ${t.stateCode} ~ '^[0-9]{2}$'`),
    // A PAN; a registered supplier's is the GSTIN's characters 3 to 12.
    check(
      'vendors_pan_check',
      sql`${t.pan} is null or (${t.pan} ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
          and (${t.gstin} is null or ${t.pan} = substr(${t.gstin}, 3, 10)))`,
    ),
    check('vendors_address_object_check', sql`jsonb_typeof(${t.addressJson}) = 'object'`),
    check(
      'vendors_payment_terms_check',
      sql`${t.paymentTermsDays} is null or ${t.paymentTermsDays} between 0 and 365`,
    ),
    check(
      'vendors_lead_time_check',
      sql`${t.leadTimeDays} is null or ${t.leadTimeDays} between 0 and 365`,
    ),
    check('vendors_notes_check', sql`${t.notes} is null or length(${t.notes}) <= 2000`),
    uniqueIndex('vendors_gstin_unique')
      .on(t.gstin)
      .where(sql`${t.gstin} is not null`),
    index('vendors_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    // The vendors list pages by name.
    index('vendors_active_name_idx').on(t.isActive, t.name, t.id),
  ],
);

/** A vendor's people (procurement.vendor.contact.set replaces them as a set). */
export const vendorContacts = pgTable(
  'vendor_contacts',
  {
    id: uuid('id').primaryKey(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    name: text('name').notNull(),
    role: text('role'),
    phoneE164: text('phone_e164'),
    email: text('email'),
    position: smallint('position').notNull(),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('vendor_contacts_name_check', sql`length(btrim(${t.name})) between 2 and 120`),
    check('vendor_contacts_role_check', sql`${t.role} is null or length(${t.role}) <= 80`),
    check(
      'vendor_contacts_phone_check',
      sql`${t.phoneE164} is null or ${t.phoneE164} ~ '^\\+[1-9]\\d{6,14}$'`,
    ),
    check(
      'vendor_contacts_email_check',
      sql`${t.email} is null or (length(${t.email}) <= 254 and ${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')`,
    ),
    check('vendor_contacts_position_check', sql`${t.position} between 1 and 20`),
    unique('vendor_contacts_vendor_position_unique').on(t.vendorId, t.position),
  ],
);

/**
 * Which vendor supplies which item, with the vendor's own code for it; at most one preferred
 * vendor per item (`item_vendors_one_preferred`).
 */
export const itemVendors = pgTable(
  'item_vendors',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    vendorItemCode: text('vendor_item_code'),
    isPreferred: boolean('is_preferred').notNull().default(false),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'item_vendors_code_check',
      sql`${t.vendorItemCode} is null or length(btrim(${t.vendorItemCode})) between 1 and 60`,
    ),
    unique('item_vendors_item_vendor_unique').on(t.itemId, t.vendorId),
    uniqueIndex('item_vendors_one_preferred')
      .on(t.itemId)
      .where(sql`${t.isPreferred}`),
    index('item_vendors_vendor_idx').on(t.vendorId),
  ],
);

/**
 * A supplier's quoted rate for an item (restricted, docs/05-database.md §4.3): read only with
 * `procurement.rate.read`, a group quote (`entity_id` null) by a holder acting in any company, a
 * company's quote only by a holder acting in that company. `rate` is per purchase unit, excluding
 * GST. A quote is recorded once and only withdrawn after (`vendor_quotes_guard`).
 */
export const vendorQuotes = pgTable(
  'vendor_quotes',
  {
    id: uuid('id').primaryKey(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    entityId: smallint('entity_id').references(() => entities.id),
    rate: numeric('rate', { precision: 14, scale: 4 }).notNull(),
    moq: numeric('moq', { precision: 12, scale: 3 }),
    leadTimeDays: smallint('lead_time_days'),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until').notNull(),
    fileId: uuid('file_id').references(() => files.id),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => principals.id),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnBy: uuid('withdrawn_by').references(() => principals.id),
    ...timestamps,
  },
  (t) => [
    check('vendor_quotes_rate_check', sql`${t.rate} > 0`),
    check('vendor_quotes_moq_check', sql`${t.moq} is null or ${t.moq} > 0`),
    check(
      'vendor_quotes_lead_time_check',
      sql`${t.leadTimeDays} is null or ${t.leadTimeDays} between 0 and 365`,
    ),
    check('vendor_quotes_validity_check', sql`${t.validUntil} >= ${t.validFrom}`),
    check(
      'vendor_quotes_withdrawn_check',
      sql`(${t.withdrawnAt} is null) = (${t.withdrawnBy} is null)`,
    ),
    // The comparison reads an item's live quotes; the vendor sheet a vendor's.
    index('vendor_quotes_item_idx').on(t.itemId, t.vendorId),
    index('vendor_quotes_vendor_idx').on(t.vendorId, t.validUntil),
    index('vendor_quotes_entity_idx').on(t.entityId),
    index('vendor_quotes_file_idx').on(t.fileId),
  ],
);
