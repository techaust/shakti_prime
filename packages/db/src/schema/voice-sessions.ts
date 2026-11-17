import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { entities } from './entities';
import { files } from './files';
import { principals } from './principals';

/**
 * A "Talk to Shakti" session (docs/03-roadmap-appendix/phase2.md §7.5, BLUEPRINT §9.2, ADR 0010).
 * Its id is also its `voice_session` principal's and its LiveKit room's name. `entity_ids` lists
 * the companies it covers and `entity_id` names the one company when there is one, as Ask's
 * conversations do. Read by its person, and by the Executive (`audit.read` for the group), in a
 * request covering all its companies; written only through `app.voice_session_open()` (the
 * person's `voice.session.start`) and `app.record_voice_session()` (the platform's
 * `voice.session.record`). `minutes` is whole minutes, rounded up, and stays null until the
 * session ends.
 */
export const voiceSessions = pgTable(
  'voice_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => principals.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => principals.id),
    entityId: smallint('entity_id').references(() => entities.id),
    entityIds: smallint('entity_ids').array().notNull(),
    mode: text('mode').notNull(),
    consentRecording: boolean('consent_recording').notNull(),
    audioFileId: uuid('audio_file_id').references(() => files.id),
    transcriptFileId: uuid('transcript_file_id').references(() => files.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    minutes: integer('minutes'),
    costPaise: integer('cost_paise').notNull().default(0),
    turnStatsJson: jsonb('turn_stats_json').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'voice_sessions_companies_check',
      sql`cardinality(${t.entityIds}) between 1 and 32
      and array_position(${t.entityIds}, null) is null
      and case when ${t.entityId} is null then cardinality(${t.entityIds}) > 1
               else cardinality(${t.entityIds}) = 1 and ${t.entityIds}[1] = ${t.entityId} end`,
    ),
    check('voice_sessions_mode_check', sql`${t.mode} in ('teach', 'ask')`),
    check(
      'voice_sessions_ended_check',
      sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`,
    ),
    check(
      'voice_sessions_minutes_check',
      sql`${t.minutes} is null or (${t.minutes} between 0 and 1440 and ${t.endedAt} is not null)`,
    ),
    check('voice_sessions_cost_check', sql`${t.costPaise} >= 0`),
    check(
      'voice_sessions_turn_stats_check',
      sql`jsonb_typeof(${t.turnStatsJson}) = 'object'`,
    ),
    // A recording is kept only with the person's yes to the recording question.
    check(
      'voice_sessions_recording_check',
      sql`${t.consentRecording} or (${t.audioFileId} is null and ${t.transcriptFileId} is null)`,
    ),
    // The person's sessions, newest first: the day's minutes and spend, and their list.
    index('voice_sessions_user_started_idx').on(t.userId, t.startedAt.desc()),
    // The Executive's list across the group.
    index('voice_sessions_started_idx').on(t.startedAt.desc()),
    index('voice_sessions_audio_file_idx')
      .on(t.audioFileId)
      .where(sql`${t.audioFileId} is not null`),
    index('voice_sessions_transcript_file_idx')
      .on(t.transcriptFileId)
      .where(sql`${t.transcriptFileId} is not null`),
  ],
);
