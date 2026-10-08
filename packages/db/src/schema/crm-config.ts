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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { actors, actorsRequired, archivable, timestamps } from './columns';
import { entities } from './entities';

const SEGMENTS = sql.raw(
  `('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale')`,
);

/**
 * The call outcomes a caller records with one number key (CALL-1, TEL-01). A list belongs to a
 * scope: the group (`entity_id` null) or one company, for every segment (`segment` null) or one.
 * `crm.disposition.set` replaces a scope's list as a set, archiving the rows it replaces, so the
 * calls that name a row keep its meaning. The group list is a workshop default the seed writes
 * once (docs/03-roadmap-appendix/phase1.md §11).
 */
export const callDispositions = pgTable(
  'call_dispositions',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    segment: text('segment'),
    /** The number key the caller presses, 1 to 9. */
    key: smallint('key').notNull(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    nextAction: text('next_action').notNull(),
    position: smallint('position').notNull(),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    check(
      'call_dispositions_segment_check',
      sql`${t.segment} is null or ${t.segment} in ${SEGMENTS}`,
    ),
    check('call_dispositions_key_check', sql`${t.key} between 1 and 9`),
    check('call_dispositions_code_check', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check('call_dispositions_label_check', sql`char_length(${t.label}) between 2 and 40`),
    check(
      'call_dispositions_next_action_check',
      sql`${t.nextAction} in ('callback', 'retry', 'qualified', 'not_interested', 'wrong_number', 'nurture')`,
    ),
    check('call_dispositions_position_check', sql`${t.position} between 1 and 9`),
    // One live row per key and per code in a scope; archived rows keep what calls recorded.
    uniqueIndex('call_dispositions_scope_key_unique')
      .on(sql`coalesce(${t.entityId}, 0)`, sql`coalesce(${t.segment}, '')`, t.key)
      .where(sql`${t.archivedAt} is null`),
    uniqueIndex('call_dispositions_scope_code_unique')
      .on(sql`coalesce(${t.entityId}, 0)`, sql`coalesce(${t.segment}, '')`, t.code)
      .where(sql`${t.archivedAt} is null`),
    index('call_dispositions_entity_idx').on(t.entityId),
  ],
);

/**
 * Lead score rules (CRM-06, workshop CRM-3): each rule adds `points` (−50 to 50) to the base score
 * when its factor matches the lead (`match_json`, read by `scoreLead()` in
 * `packages/domain/src/crm/score.ts`). A rule belongs to the group or one company, and to every
 * segment or one. Empty until the workshop answers, so every lead starts level.
 */
export const leadScoreRules = pgTable(
  'lead_score_rules',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    segment: text('segment'),
    factor: text('factor').notNull(),
    matchJson: jsonb('match_json').notNull().default({}),
    points: smallint('points').notNull(),
    position: smallint('position').notNull(),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'lead_score_rules_segment_check',
      sql`${t.segment} is null or ${t.segment} in ${SEGMENTS}`,
    ),
    check(
      'lead_score_rules_factor_check',
      sql`${t.factor} in ('source', 'segment', 'district', 'system_size', 'age_days')`,
    ),
    check(
      'lead_score_rules_points_check',
      sql`${t.points} between -50 and 50 and ${t.points} <> 0`,
    ),
    check('lead_score_rules_position_check', sql`${t.position} between 1 and 50`),
    index('lead_score_rules_entity_idx').on(t.entityId),
  ],
);

/**
 * A referral partner (CRM-09): a customer of type `referral_partner` with a code; a lead that gives
 * the code is credited to them. Codes are unique whatever their case. Read with the partner's
 * customer record, written with `crm.config.write:all` (the Executive); a lead resolves a code
 * through the definer `app.referral_partner_for_code()`, since a caller rarely reads the partner
 * itself.
 */
export const referralPartners = pgTable(
  'referral_partners',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id),
    code: text('code').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('referral_partners_code_check', sql`${t.code} ~ '^[A-Za-z0-9]{4,12}$'`),
    uniqueIndex('referral_partners_code_unique').on(sql`upper(${t.code})`),
  ],
);

/**
 * How a referral partner's commission is worked out (workshop CRM-5): per partner, or the
 * group's default when `partner_id` is null; effective-dated, one rule at a time per partner
 * (an exclusion constraint in the RLS migration). Empty until the workshop answers; accruals
 * belong to sales orders.
 */
export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid('id').primaryKey(),
    partnerId: uuid('partner_id').references(() => referralPartners.accountId),
    basis: text('basis').notNull(),
    /** Rupees for `fixed`, `per_kw` and `per_hp`; a percentage of the order value for `percent`. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    trigger: text('trigger').notNull().default('order_confirmed'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'commission_rules_basis_check',
      sql`${t.basis} in ('fixed', 'percent', 'per_kw', 'per_hp')`,
    ),
    check('commission_rules_trigger_check', sql`${t.trigger} in ('order_confirmed')`),
    check(
      'commission_rules_amount_check',
      sql`${t.amount} > 0 and (${t.basis} <> 'percent' or ${t.amount} <= 100)`,
    ),
    check(
      'commission_rules_effective_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    index('commission_rules_partner_idx').on(t.partnerId),
  ],
);
