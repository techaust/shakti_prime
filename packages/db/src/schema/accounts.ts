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
    nameHi: text('name_hi'),
    gstin: text('gstin'),
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
    index('accounts_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('accounts_tier_idx').on(t.tierId),
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
    role: text('role').notNull().default('owner'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.contactId] }),
    index('account_contacts_contact_idx').on(t.contactId),
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
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),
    technicalJson: jsonb('technical_json').notNull().default({}),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('customer_sites_type_check', sql`${t.type} in ('borewell', 'rooftop', 'factory')`),
    check('customer_sites_pin_check', sql`${t.pin} is null or ${t.pin} ~ '^[1-9][0-9]{5}$'`),
    index('customer_sites_village_trgm_idx').using('gin', t.village.op('gin_trgm_ops')),
    index('customer_sites_account_idx').on(t.accountId),
  ],
);
