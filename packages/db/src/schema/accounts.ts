import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, archivable, timestamps } from './columns';
import { contacts } from './contacts';
import { entities } from './entities';
import { priceTiers } from './pricing';
import { principals } from './principals';
import { teams } from './teams';

/**
 * A household, farm, business, dealer or referral partner (docs/BLUEPRINT.md §6.2). One record
 * for the group (ADR 0008): the entities it deals with, and who owns the relationship in each,
 * live in `account_entities`.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    gstin: text('gstin'),
    /** Two-digit GST state code of the billing address; place of supply falls back to it (design §6). */
    billingStateCode: text('billing_state_code'),
    tierId: uuid('tier_id').references(() => priceTiers.id),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'accounts_type_check',
      sql`${t.type} in ('household', 'farm', 'business', 'dealer', 'referral_partner')`,
    ),
    check(
      'accounts_gstin_check',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check(
      'accounts_billing_state_code_check',
      sql`${t.billingStateCode} is null or ${t.billingStateCode} ~ '^[0-9]{2}$'`,
    ),
    index('accounts_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    // The customers list pages by name (`listCustomers`).
    index('accounts_name_id_idx').on(t.name, t.id),
    index('accounts_tier_idx').on(t.tierId),
    // The duplicate search compares names whatever their case and spacing (`matchText()`).
    index('accounts_match_name_idx').using(
      'btree',
      sql`lower(btrim(regexp_replace(${t.name}, '\\s+', ' ', 'g')))`,
    ),
    // The referral partners of Settings › Pipelines page by name (`listReferralPartners`).
    index('accounts_referral_partner_name_idx')
      .on(t.name, t.id)
      .where(sql`${t.type} = 'referral_partner' and ${t.archivedAt} is null`),
  ],
);

/**
 * The relationship of an account with one selling entity: the scope root for `crm.account.*`.
 * Own, team and entity scope apply to this row, so each entity's staff see the shared customer
 * through their own relationship. An opportunity may only sit in an entity that has a row here.
 */
export const accountEntities = pgTable(
  'account_entities',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    ownerId: uuid('owner_id').references(() => principals.id),
    teamId: uuid('team_id').references(() => teams.id),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('account_entities_account_entity_key').on(t.accountId, t.entityId),
    index('account_entities_entity_owner_idx').on(t.entityId, t.ownerId),
    index('account_entities_entity_team_idx').on(t.entityId, t.teamId),
  ],
);

/** Contacts linked to an account through a role. Visibility follows the account. */
export const accountContacts = pgTable(
  'account_contacts',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    // Named on every link (AUDIT M20): one owner per customer; family and staff take other roles.
    role: text('role').notNull(),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.contactId] }),
    index('account_contacts_contact_idx').on(t.contactId),
    uniqueIndex('account_contacts_one_owner')
      .on(t.accountId)
      .where(sql`${t.role} = 'owner'`),
    check(
      'account_contacts_role_check',
      sql`${t.role} in ('owner', 'family', 'manager', 'accountant', 'other')`,
    ),
  ],
);

/** A borewell, rooftop or factory with its geography and technical data. Visibility follows the account. */
export const customerSites = pgTable(
  'customer_sites',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    type: text('type').notNull(),
    address: text('address'),
    village: text('village'),
    tehsil: text('tehsil'),
    district: text('district'),
    pin: text('pin'),
    /** Two-digit GST state code of the site; the first choice for place of supply (design §6). */
    stateCode: text('state_code'),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),
    technicalJson: jsonb('technical_json').notNull().default({}),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('customer_sites_type_check', sql`${t.type} in ('borewell', 'rooftop', 'factory')`),
    // A map point on the globe (AUDIT L3).
    check(
      'customer_sites_point_check',
      sql`(${t.lat} is null or ${t.lat} between -90 and 90) and (${t.lng} is null or ${t.lng} between -180 and 180)`,
    ),
    check('customer_sites_pin_check', sql`${t.pin} is null or ${t.pin} ~ '^[1-9][0-9]{5}$'`),
    check(
      'customer_sites_state_code_check',
      sql`${t.stateCode} is null or ${t.stateCode} ~ '^[0-9]{2}$'`,
    ),
    index('customer_sites_village_trgm_idx').using('gin', t.village.op('gin_trgm_ops')),
    index('customer_sites_account_idx').on(t.accountId),
    // The duplicate search compares villages whatever their case and spacing (`matchText()`).
    index('customer_sites_match_village_idx')
      .using('btree', sql`lower(btrim(regexp_replace(${t.village}, '\\s+', ' ', 'g')))`)
      .where(sql`${t.village} is not null and ${t.archivedAt} is null`),
  ],
);
