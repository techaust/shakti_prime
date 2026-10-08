import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import { customerSites } from './accounts';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { files } from './files';
import { items } from './items';
import { kits } from './kits';
import { opportunities } from './opportunities';
import { priceLists, priceTiers } from './pricing';
import { principals } from './principals';
import { sizings } from './sizings';
import { compositeSupplyRules, taxRates } from './tax';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const percent = (name: string) => numeric(name, { precision: 5, scale: 2 });

/**
 * A quote of a lead (docs/03-roadmap-appendix/phase1.md §7.3, docs/05-database.md §6.4), a child of
 * `opportunities`: read with the lead, made with `sales.quote.create` over the lead's owner and
 * team. Its lines, totals, tier, list and place of supply are frozen when it is made; afterwards
 * only its state (through the quote machine), the reason it was withdrawn and the PDF the render
 * worker attaches change. `quote_no` comes from the company's gapless series for the financial
 * year (`app.next_document_no()`).
 */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    quoteNo: text('quote_no').notNull(),
    /** The financial year of the series the number came from, `2026-27`. */
    fy: text('fy').notNull(),
    opportunityId: uuid('opportunity_id').notNull(),
    accountId: uuid('account_id').notNull(),
    siteId: uuid('site_id').references(() => customerSites.id),
    /** The lead's newest sizing the guards read, when there was one. */
    sizingId: uuid('sizing_id').references(() => sizings.id),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => priceTiers.id),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id),
    scheme: text('scheme').notNull(),
    placeOfSupplyState: text('place_of_supply_state').notNull(),
    supplyKind: text('supply_kind').notNull(),
    /** The last millisecond of the last valid day in IST (`quoteValidUntil`). */
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    state: text('state').notNull().default('draft'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    subtotal: money('subtotal').notNull(),
    cgst: money('cgst').notNull(),
    sgst: money('sgst').notNull(),
    igst: money('igst').notNull(),
    taxTotal: money('tax_total').notNull(),
    roundOff: money('round_off').notNull(),
    grandTotal: money('grand_total').notNull(),
    pdfFileId: uuid('pdf_file_id').references(() => files.id),
    /** The quote this one replaced at current prices (`sales.quote.requote`). */
    supersedesId: uuid('supersedes_id'),
    withdrawnReason: text('withdrawn_reason'),
    /**
     * How the customer accepted it (`whatsapp_reply`, `whatsapp_otp` or `signed_upload`), and for
     * a signed copy uploaded by staff, the file (`signed_quote`, `sales.quote.accept`, SAL-05).
     */
    acceptedVia: text('accepted_via'),
    signedFileId: uuid('signed_file_id').references(() => files.id),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('quotes_entity_quote_no_unique').on(t.entityId, t.quoteNo),
    // The key the lines and a re-quote point at, so they stay in the quote's company.
    unique('quotes_id_entity_unique').on(t.id, t.entityId),
    // The quote belongs to its lead's company and customer; it follows the lead when a customer
    // merge moves the lead, and back when the merge is undone (`app.merge_customers()`).
    foreignKey({
      name: 'quotes_opportunity_fk',
      columns: [t.opportunityId, t.entityId, t.accountId],
      foreignColumns: [opportunities.id, opportunities.entityId, opportunities.accountId],
    }).onUpdate('cascade'),
    foreignKey({
      name: 'quotes_supersedes_fk',
      columns: [t.supersedesId, t.entityId],
      foreignColumns: [t.id, t.entityId],
    }),
    // A quote is replaced once.
    uniqueIndex('quotes_supersedes_unique')
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} is not null`),
    check(
      'quotes_state_check',
      sql`${t.state} in ('draft', 'sent', 'accepted', 'expired', 'superseded', 'withdrawn')`,
    ),
    check('quotes_scheme_check', sql`${t.scheme} in ('none', 'pm_surya_ghar', 'pm_kusum')`),
    check('quotes_supply_kind_check', sql`${t.supplyKind} in ('intra', 'inter')`),
    check('quotes_place_of_supply_check', sql`${t.placeOfSupplyState} ~ '^[0-9]{2}$'`),
    check(
      'quotes_fy_check',
      sql`${t.fy} ~ '^[0-9]{4}-[0-9]{2}$' and right(${t.fy}, 2)::int = (left(${t.fy}, 4)::int + 1) % 100`,
    ),
    check(
      'quotes_totals_check',
      sql`${t.subtotal} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0 and ${t.taxTotal} = ${t.cgst} + ${t.sgst} + ${t.igst} and ${t.grandTotal} = ${t.subtotal} + ${t.taxTotal} + ${t.roundOff}`,
    ),
    // The document total rounds half-up to the rupee (ADR 0007).
    check('quotes_round_off_check', sql`${t.roundOff} between -0.49 and 0.50`),
    // A withdrawn quote says why; no other quote carries a reason.
    check(
      'quotes_withdrawn_reason_check',
      sql`(${t.state} = 'withdrawn') = (${t.withdrawnReason} is not null)`,
    ),
    check(
      'quotes_accepted_via_check',
      sql`${t.acceptedVia} is null or ${t.acceptedVia} in ('whatsapp_reply', 'whatsapp_otp', 'signed_upload')`,
    ),
    // An accepted quote says how; a signed copy is named exactly when it was the way.
    check(
      'quotes_acceptance_check',
      sql`(${t.state} = 'accepted') = (${t.acceptedVia} is not null)
       and (${t.signedFileId} is not null) = (${t.acceptedVia} is not distinct from 'signed_upload')`,
    ),
    // `/quotes` pages newest first, for one company or every company of the request: read
    // backwards, these serve the list's plain `order by created_at desc, id desc`.
    index('quotes_entity_created_idx').on(t.entityId, t.createdAt, t.id),
    index('quotes_created_idx').on(t.createdAt, t.id),
    // A lead's quotes (the RLS exists on its lead runs the other way, by the lead's key).
    index('quotes_opportunity_idx').on(t.opportunityId),
    // Account 360's quotes, newest first.
    index('quotes_account_idx').on(t.accountId, t.entityId, t.createdAt),
    // ⌘K finds a quote by any part of its number (RPT-03).
    index('quotes_quote_no_trgm_idx').using('gin', t.quoteNo.op('gin_trgm_ops')),
    // The daily expiry reads only the quotes that may still lapse.
    index('quotes_open_valid_until_idx')
      .on(t.entityId, t.validUntil)
      .where(sql`${t.state} in ('draft', 'sent')`),
    index('quotes_pdf_file_idx').on(t.pdfFileId),
    index('quotes_signed_file_idx').on(t.signedFileId),
  ],
);

/**
 * One priced line of a quote, written with its quote and never changed: the item or kit, the
 * Price Master price, and the tax engine's snapshot with the rate row and rate it used (ADR 0007),
 * so a later rate change never alters an issued quote.
 */
export const quoteLines = pgTable(
  'quote_lines',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    quoteId: uuid('quote_id').notNull(),
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
    compositeRuleId: uuid('composite_rule_id').references(() => compositeSupplyRules.id),
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
    unique('quote_lines_quote_position_unique').on(t.quoteId, t.position),
    foreignKey({
      name: 'quote_lines_quote_entity_fk',
      columns: [t.quoteId, t.entityId],
      foreignColumns: [quotes.id, quotes.entityId],
    }),
    check('quote_lines_target_check', sql`(${t.itemId} is null) <> (${t.kitId} is null)`),
    check('quote_lines_position_check', sql`${t.position} >= 1`),
    check('quote_lines_qty_check', sql`${t.qty} > 0`),
    check(
      'quote_lines_unit_check',
      sql`${t.unit} in ('nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour')`,
    ),
    check(
      'quote_lines_hsn_check',
      sql`${t.hsn} is null or ${t.hsn} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'`,
    ),
    // A line is taxed at its own rate or, as a works contract, by a composite rule (ADR 0007).
    check(
      'quote_lines_tax_check',
      sql`(${t.taxRateId} is not null and ${t.taxRatePct} is not null and ${t.compositeRuleId} is null and ${t.goodsRatePct} is null and ${t.servicesRatePct} is null and ${t.goodsTaxable} is null and ${t.servicesTaxable} is null)
       or (${t.taxRateId} is null and ${t.taxRatePct} is null and ${t.compositeRuleId} is not null and ${t.worksContract} and ${t.goodsRatePct} is not null and ${t.servicesRatePct} is not null and ${t.goodsTaxable} is not null and ${t.servicesTaxable} is not null)`,
    ),
    check(
      'quote_lines_amounts_check',
      sql`${t.unitPrice} >= 0 and ${t.taxableValue} >= 0 and ${t.cgst} >= 0 and ${t.sgst} >= 0 and ${t.igst} >= 0 and ${t.lineTotal} = ${t.taxableValue} + ${t.cgst} + ${t.sgst} + ${t.igst}`,
    ),
  ],
);

/**
 * Frozen copies of a quote (`snapshot_json`): the quote and its lines as made (version 1), and as
 * it stood when a re-quote replaced it. Append-only.
 */
export const quoteVersions = pgTable(
  'quote_versions',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    quoteId: uuid('quote_id').notNull(),
    version: integer('version').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    unique('quote_versions_quote_version_unique').on(t.quoteId, t.version),
    foreignKey({
      name: 'quote_versions_quote_entity_fk',
      columns: [t.quoteId, t.entityId],
      foreignColumns: [quotes.id, quotes.entityId],
    }),
    check('quote_versions_version_check', sql`${t.version} >= 1`),
    check('quote_versions_snapshot_check', sql`jsonb_typeof(${t.snapshotJson}) = 'object'`),
  ],
);
