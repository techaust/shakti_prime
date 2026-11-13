import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';

/**
 * A company's own number on one channel (docs/05-database.md §6.1, docs/03-roadmap-appendix/phase2.md
 * §5.2): its WhatsApp number, its DLT-registered 140-series (promotional) and 160-series (service)
 * calling numbers, and its IVR and missed-call numbers. Entered by an Executive from Settings ›
 * Companies › Channels (`org.channel.set`), never seeded: the numbers are the client's.
 *
 * One active row per company and channel; a number replaced or removed stays as an inactive row,
 * so a call or a WhatsApp thread that named it keeps its record. `provider_ref` is how a provider
 * names the number (WhatsApp's `phone_number_id`, Exotel's ExoPhone sid), unique among active
 * rows because an inbound delivery is routed to its company by it. `verified_at` is when an
 * Executive confirmed the number works for this channel; a changed number starts unverified.
 */
export const entityChannels = pgTable(
  'entity_channels',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    channel: text('channel').notNull(),
    numberE164: text('number_e164').notNull(),
    providerRef: text('provider_ref'),
    /** The header registered on DLT for this number, kept for the record. */
    dltHeader: text('dlt_header'),
    isActive: boolean('is_active').notNull().default(true),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'entity_channels_channel_check',
      sql`${t.channel} in ('whatsapp', 'call_promo_140', 'call_service_160', 'ivr', 'missed_call')`,
    ),
    check('entity_channels_number_e164_check', sql`${t.numberE164} ~ '^\\+[1-9]\\d{6,14}$'`),
    check(
      'entity_channels_provider_ref_check',
      sql`${t.providerRef} is null or ${t.providerRef} ~ '^[A-Za-z0-9_.:-]{1,64}$'`,
    ),
    check(
      'entity_channels_dlt_header_check',
      sql`${t.dltHeader} is null or char_length(${t.dltHeader}) between 1 and 40`,
    ),
    uniqueIndex('entity_channels_active_unique')
      .on(t.entityId, t.channel)
      .where(sql`${t.isActive}`),
    uniqueIndex('entity_channels_provider_ref_unique')
      .on(t.providerRef)
      .where(sql`${t.isActive} and ${t.providerRef} is not null`),
  ],
);
