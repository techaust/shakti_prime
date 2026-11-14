import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { calls } from './calls';
import { contactPhones } from './contacts';
import { entities } from './entities';
import { files } from './files';
import { opportunities } from './opportunities';
import { principals } from './principals';

/**
 * A call the telephony provider placed or reported (docs/05-database.md §6.2,
 * docs/03-roadmap-appendix/phase2.md §6.3, PRD TEL-01): a child of the lead, read with it. A person
 * records it as `dialling` when they press Dial (`calls.call.dial`), and from then on only the
 * platform (`calls.process`, through definers) records what the provider reports: its call id,
 * each status, when it was answered and ended, its length and its recording. A status only moves
 * forward (`app.provider_calls_guard()`), so a repeated or late report changes nothing back.
 *
 * Its own table, not columns of `calls`: a call log is written once by the person who made the
 * call and never changed, while a provider call changes several times after it starts. The
 * person's log links to it (`call_id`, set once by `calls.call.log`).
 */
export const providerCalls = pgTable(
  'provider_calls',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    opportunityId: uuid('opportunity_id').notNull(),
    /** The customer's phone called; it is never copied here, only named. */
    contactPhoneId: uuid('contact_phone_id').references(() => contactPhones.id),
    /** The person who pressed Dial. */
    callerId: uuid('caller_id').references(() => principals.id),
    direction: text('direction').notNull(),
    /** The company's line: the 140 (promotional) or 160 (service) number, the IVR or missed-call number. */
    series: text('series').notNull(),
    purpose: text('purpose'),
    /** The provider's own id of the call (Exotel's CallSid), set once by the platform. */
    providerCallSid: text('provider_call_sid'),
    status: text('status').notNull().default('dialling'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Seconds the customer was on the line, as the provider reports it. */
    durationS: integer('duration_s'),
    recordingFileId: uuid('recording_file_id'),
    transcriptFileId: uuid('transcript_file_id'),
    /** The person's log of this call, set once when they log it. */
    callId: uuid('call_id').references(() => calls.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('provider_calls_direction_check', sql`${t.direction} in ('outbound', 'inbound')`),
    check('provider_calls_series_check', sql`${t.series} in ('140', '160', 'ivr', 'missed_call')`),
    check(
      'provider_calls_purpose_check',
      sql`${t.purpose} is null or ${t.purpose} in ('promotional', 'service')`,
    ),
    check(
      'provider_calls_status_check',
      sql`${t.status} in ('dialling', 'ringing', 'in_progress', 'completed', 'no_answer', 'busy', 'failed', 'canceled')`,
    ),
    // An outbound call is a person's dial: it names the person, the phone and the purpose.
    check(
      'provider_calls_outbound_check',
      sql`${t.direction} <> 'outbound' or (${t.callerId} is not null and ${t.contactPhoneId} is not null and ${t.purpose} is not null and ${t.series} in ('140', '160'))`,
    ),
    check(
      'provider_calls_sid_check',
      sql`${t.providerCallSid} is null or ${t.providerCallSid} ~ '^[A-Za-z0-9_.:-]{1,80}$'`,
    ),
    check(
      'provider_calls_duration_check',
      sql`${t.durationS} is null or ${t.durationS} between 0 and 14400`,
    ),
    // The call belongs to its lead's company, and its files to the same company.
    foreignKey({
      name: 'provider_calls_opportunity_entity_fk',
      columns: [t.opportunityId, t.entityId],
      foreignColumns: [opportunities.id, opportunities.entityId],
    }),
    foreignKey({
      name: 'provider_calls_recording_entity_fk',
      columns: [t.recordingFileId, t.entityId],
      foreignColumns: [files.id, files.entityId],
    }),
    foreignKey({
      name: 'provider_calls_transcript_entity_fk',
      columns: [t.transcriptFileId, t.entityId],
      foreignColumns: [files.id, files.entityId],
    }),
    uniqueIndex('provider_calls_sid_unique').on(t.providerCallSid),
    uniqueIndex('provider_calls_call_unique').on(t.callId),
    // A lead's provider calls, newest first (its timeline, the log's link).
    index('provider_calls_opportunity_started_idx').on(
      t.opportunityId,
      t.startedAt.desc(),
      t.id.desc(),
    ),
    // A caller's calls of a day, and the one they are on now.
    index('provider_calls_caller_started_idx').on(t.callerId, t.startedAt),
    index('provider_calls_contact_phone_idx').on(t.contactPhoneId),
    index('provider_calls_recording_idx')
      .on(t.recordingFileId)
      .where(sql`${t.recordingFileId} is not null`),
    index('provider_calls_transcript_idx')
      .on(t.transcriptFileId)
      .where(sql`${t.transcriptFileId} is not null`),
  ],
);
