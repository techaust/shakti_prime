import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';

const NOTICE_TYPES = sql.raw(
  "('lead_assigned', 'duplicate_found', 'call_due', 'quote_expiring', 'first_call_late', 'enquiry_routed')",
);

/**
 * A notice for one person about one record (PRD RPT-04, docs/03-roadmap-appendix/phase1.md §8.1): written only
 * by the notify worker and its scan through `app.write_notices()`, one per person and reason
 * (`dedupe_key`), so a repeated delivery or scan makes one notice. A person reads their own notices
 * in the request's companies and marks them read; nobody else reads them. `payload_json` holds the
 * ids the notice's link is made from, never a name, a number or free text; the words come from the
 * message catalogue by `type`. `channel_sent_json` records whether the notice shows in the centre
 * (`inApp`) and what became of its push (`push`).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => principals.id),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    type: text('type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    payloadJson: jsonb('payload_json').notNull().default({}),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    channelSentJson: jsonb('channel_sent_json').notNull().default({}),
  },
  (t) => [
    unique('notifications_user_dedupe_unique').on(t.userId, t.dedupeKey),
    check('notifications_type_check', sql`${t.type} in ${NOTICE_TYPES}`),
    check(
      'notifications_subject_type_check',
      sql`${t.subjectType} in ('opportunity', 'duplicate_candidate', 'task', 'quote', 'inbox_item')`,
    ),
    check('notifications_payload_check', sql`jsonb_typeof(${t.payloadJson}) = 'object'`),
    check('notifications_channels_check', sql`jsonb_typeof(${t.channelSentJson}) = 'object'`),
    check('notifications_dedupe_key_check', sql`char_length(${t.dedupeKey}) between 1 and 200`),
    // The centre's list, newest first: the person's notices by time (and the user's foreign key).
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    // The bell's count: the person's unread notices.
    index('notifications_unread_idx')
      .on(t.userId, t.entityId)
      .where(sql`${t.readAt} is null`),
    // The scan leaves out what it already told someone, by reason, in the company.
    index('notifications_entity_dedupe_idx').on(t.entityId, t.dedupeKey),
  ],
);

/**
 * A person's notification settings (docs/03-roadmap-appendix/phase1.md §8.1): one row per kind of notice they
 * changed (`type`), with its in-app and push switches, and one row with no kind for their quiet
 * hours (IST, `quiet_from` up to `quiet_to`, across midnight when `quiet_to` is earlier). With no
 * row a kind is shown and pushed, and there are no quiet hours. Each person reads and writes only
 * their own rows, whatever company they work in.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => principals.id),
    type: text('type'),
    inApp: boolean('in_app').notNull().default(true),
    push: boolean('push').notNull().default(true),
    quietFrom: time('quiet_from'),
    quietTo: time('quiet_to'),
    ...timestamps,
  },
  (t) => [
    // Also the index for the person's foreign key; the quiet hours row has no kind.
    unique('notification_preferences_user_type_unique').on(t.userId, t.type).nullsNotDistinct(),
    check(
      'notification_preferences_type_check',
      sql`${t.type} is null or ${t.type} in ${NOTICE_TYPES}`,
    ),
    check(
      'notification_preferences_quiet_check',
      sql`(${t.quietFrom} is null) = (${t.quietTo} is null)
        and (${t.quietFrom} is null or ${t.quietFrom} <> ${t.quietTo})
        and (${t.type} is null or ${t.quietFrom} is null)`,
    ),
  ],
);

/**
 * A browser a person receives pushes on (docs/03-roadmap-appendix/phase1.md §8.1): its push service address
 * (one of the services `isPushServiceEndpoint()` names) and its two keys, as the browser's
 * subscription gives them. Added by the person's tap in the notification centre, removed by them
 * or by the worker when the push service answers that it is gone (404 or 410). `last_ok_at` is the
 * last push the service took.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => principals.id),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
  },
  (t) => [
    unique('push_subscriptions_endpoint_unique').on(t.endpoint),
    check(
      'push_subscriptions_endpoint_check',
      sql`${t.endpoint} like 'https://%' and char_length(${t.endpoint}) <= 1000`,
    ),
    check(
      'push_subscriptions_keys_check',
      sql`char_length(${t.p256dh}) between 80 and 100 and char_length(${t.auth}) between 16 and 32`,
    ),
    check('push_subscriptions_user_agent_check', sql`char_length(${t.userAgent}) <= 300`),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
);
