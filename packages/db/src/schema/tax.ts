import { sql } from 'drizzle-orm';
import { check, date, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { actors, timestamps } from './columns';
import { items } from './items';

/**
 * Effective-dated GST rates per HSN or per item (SAL-02). Overlapping periods are rejected by an
 * exclusion constraint in the RLS migration; values are entered by Accounts, never seeded.
 */
export const taxRates = pgTable(
  'tax_rates',
  {
    id: uuid('id').primaryKey(),
    hsn: text('hsn'),
    itemId: uuid('item_id').references(() => items.id),
    ratePct: numeric('rate_pct', { precision: 5, scale: 2 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    sourceRef: text('source_ref'),
    ...timestamps,
    ...actors,
  },
  (t) => [
    check('tax_rates_target_check', sql`(${t.hsn} is null) <> (${t.itemId} is null)`),
    check(
      'tax_rates_hsn_check',
      sql`${t.hsn} is null or ${t.hsn} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'`,
    ),
    check('tax_rates_rate_check', sql`${t.ratePct} >= 0 and ${t.ratePct} <= 100`),
    check(
      'tax_rates_effective_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

/** Goods/services split for composite supply per segment, effective-dated (solar 70:30). */
export const compositeSupplyRules = pgTable(
  'composite_supply_rules',
  {
    id: uuid('id').primaryKey(),
    segment: text('segment').notNull(),
    goodsSharePct: numeric('goods_share_pct', { precision: 5, scale: 2 }).notNull(),
    servicesSharePct: numeric('services_share_pct', { precision: 5, scale: 2 }).notNull(),
    goodsRatePct: numeric('goods_rate_pct', { precision: 5, scale: 2 }).notNull(),
    servicesRatePct: numeric('services_rate_pct', { precision: 5, scale: 2 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...timestamps,
    ...actors,
  },
  (t) => [
    check(
      'composite_supply_rules_segment_check',
      sql`${t.segment} in ('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale')`,
    ),
    check(
      'composite_supply_rules_share_check',
      sql`${t.goodsSharePct} + ${t.servicesSharePct} = 100`,
    ),
    // Shares and rates are percentages (AUDIT L3).
    check(
      'composite_supply_rules_range_check',
      sql`${t.goodsSharePct} between 0 and 100 and ${t.servicesSharePct} between 0 and 100 and ${t.goodsRatePct} between 0 and 100 and ${t.servicesRatePct} between 0 and 100`,
    ),
    check(
      'composite_supply_rules_effective_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);
