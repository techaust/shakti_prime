import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';

/**
 * How one person takes part in the round-robin handover of qualified leads in one company
 * (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2): whether they are a Lead Converter, whether
 * they are present, how many open leads they take at most (`max_open` null for no cap), and the
 * customer languages and pipeline segments they take (an empty list takes all). One row per person
 * and company. A manager (`crm.lead.assign`) edits any row in their scope; a person changes only
 * their own `presence`.
 */
export const callerProfiles = pgTable(
  'caller_profiles',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => principals.id),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    isConverter: boolean('is_converter').notNull().default(false),
    presence: text('presence').notNull().default('away'),
    maxOpen: integer('max_open'),
    languages: text('languages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    segments: text('segments')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedBy: uuid('updated_by').references(() => principals.id),
    ...timestamps,
  },
  (t) => [
    unique('caller_profiles_user_entity_unique').on(t.userId, t.entityId),
    check('caller_profiles_presence_check', sql`${t.presence} in ('present', 'away')`),
    check(
      'caller_profiles_max_open_check',
      sql`${t.maxOpen} is null or ${t.maxOpen} between 1 and 1000`,
    ),
    check('caller_profiles_languages_check', sql`${t.languages} <@ array['hinglish', 'en']::text[]`),
    check(
      'caller_profiles_segments_check',
      sql`${t.segments} <@ array['farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale']::text[]`,
    ),
    // The handover reads a company's present converters.
    index('caller_profiles_converters_idx')
      .on(t.entityId)
      .where(sql`${t.isConverter} and ${t.presence} = 'present'`),
  ],
);
