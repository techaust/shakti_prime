import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';
import { contacts } from './contacts';
import { files } from './files';

/**
 * Consent per channel, purpose and source with a timestamp (CRM-10, DPDP). Never deleted;
 * withdrawal sets `withdrawn_at`. Visibility follows the contact. `evidence_file_id` is the signed
 * form or recording the consent rests on, fixed once written like the rest of the evidence.
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    channel: text('channel').notNull(),
    purpose: text('purpose').notNull(),
    source: text('source').notNull(),
    textVersion: text('text_version').notNull(),
    givenAt: timestamp('given_at', { withTimezone: true }).notNull(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    evidenceFileId: uuid('evidence_file_id').references(() => files.id),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('consents_channel_check', sql`${t.channel} in ('whatsapp', 'call', 'sms', 'email')`),
    check('consents_purpose_check', sql`${t.purpose} in ('service', 'promotional')`),
    check(
      'consents_source_check',
      sql`${t.source} in ('web_form', 'whatsapp_opt_in', 'walk_in_form', 'verbal', 'import')`,
    ),
    index('consents_contact_idx').on(t.contactId, t.channel, t.purpose),
    index('consents_evidence_file_idx').on(t.evidenceFileId),
  ],
);
