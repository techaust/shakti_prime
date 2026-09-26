import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, archivable, timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';
import { teams } from './teams';

/** A person (docs/BLUEPRINT.md §6.2). Scope root: `owner_id` and `team_id` drive own/team visibility. */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    name: text('name').notNull(),
    nameHi: text('name_hi'),
    searchRoman: text('search_roman'),
    email: text('email'),
    preferredLanguage: text('preferred_language').notNull().default('hi'),
    ownerId: uuid('owner_id').references(() => principals.id),
    teamId: uuid('team_id').references(() => teams.id),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('contacts_preferred_language_check', sql`${t.preferredLanguage} in ('en', 'hi')`),
    index('contacts_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('contacts_search_roman_trgm_idx').using('gin', t.searchRoman.op('gin_trgm_ops')),
    index('contacts_entity_owner_idx').on(t.entityId, t.ownerId),
  ],
);

/** Phones in E.164; families share numbers, so a phone belongs to a contact, not an account. */
export const contactPhones = pgTable(
  'contact_phones',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    e164: text('e164').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    isWhatsapp: boolean('is_whatsapp').notNull().default(false),
    dndCheckedAt: timestamp('dnd_checked_at', { withTimezone: true }),
    isDnd: boolean('is_dnd').notNull().default(false),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('contact_phones_e164_check', sql`${t.e164} ~ '^\\+[1-9]\\d{6,14}$'`),
    unique('contact_phones_contact_e164_unique').on(t.contactId, t.e164),
    index('contact_phones_e164_idx').on(t.e164),
  ],
);
