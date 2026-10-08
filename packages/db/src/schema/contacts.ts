import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, archivable, timestamps } from './columns';

/**
 * A person (docs/01-blueprint.md §6.2, ADR 0008). Shared across the four entities: a contact
 * carries no entity and no owner; it is visible through the accounts it is linked to, whose
 * per-entity memberships carry the ownership.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    preferredLanguage: text('preferred_language').notNull().default('hinglish'),
    /**
     * The name as the import's dedupe compares it (`matchKey` in packages/domain/src/imports/leads.ts):
     * lower case, letters and digits only. Stored, so an equality on it is an index condition under
     * the policies (docs/05-database.md §4.2).
     */
    nameKey: text('name_key').generatedAlwaysAs(
      sql`regexp_replace(lower(name), '[^a-z0-9]+', '', 'g')`,
    ),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('contacts_preferred_language_check', sql`${t.preferredLanguage} in ('hinglish', 'en')`),
    index('contacts_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('contacts_name_key_idx')
      .on(t.nameKey)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/** Phones in E.164; families share numbers, so a phone belongs to a contact, not an account. */
export const contactPhones = pgTable(
  'contact_phones',
  {
    id: uuid('id').primaryKey(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    e164: text('e164').notNull(),
    // The number written backwards, so a search by its last digits is a prefix match the index
    // below serves. A plain column, not reverse() in the query: RLS runs a search's own filter
    // only after the policies unless every function in it is leakproof, and reverse() and LIKE
    // are not, while starts_with (^@) is.
    e164Reversed: text('e164_reversed').generatedAlwaysAs(sql`reverse(e164)`),
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
    // One primary number per contact: the lead list and the existing-customer path join on it.
    uniqueIndex('contact_phones_primary_unique')
      .on(t.contactId)
      .where(sql`${t.isPrimary}`),
    index('contact_phones_e164_idx').on(t.e164),
    // ⌘K search by a phone's last digits: `e164_reversed ^@ <digits reversed>` (search-leads.ts).
    index('contact_phones_e164_reversed_idx').on(t.e164Reversed.op('text_pattern_ops')),
  ],
);
