import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, archivable, timestamps } from './columns';
import { entities } from './entities';
import { opportunities } from './opportunities';
import { pipelines } from './pipelines';
import { principals } from './principals';

/**
 * A company's connected lead form, Page or website (docs/05-database.md §6.2,
 * docs/03-roadmap-appendix/phase2.md §6.2): where a lead from an integration lands (its pipeline,
 * and so its business line), how the form's questions map to the lead's details and qualification
 * facts (`field_map_json`), which question records consent and the version of its wording, and,
 * for a Meta form, the Page's access token sealed by the field cipher (`page_token_sealed`, never
 * read back by a request role: the Lead Ads handler opens it through `app.ingest_source_token()`).
 * Set up by an Executive in Settings › Lead sources (`crm.source.set`, `.archive`); never seeded,
 * since the forms are the client's. `lead_sources` is the group's list of channels a lead's source
 * names; this table is one company's connection on one of them.
 *
 * `last_questions_json` is the question keys of the newest lead the form sent, so the field map
 * can be set from what the form really asks; the platform writes it.
 */
export const ingestSources = pgTable(
  'ingest_sources',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    provider: text('provider').notNull(),
    /** The form id (Meta, Google) or the site's host name (website). */
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    fieldMapJson: jsonb('field_map_json').notNull().default({}),
    consentQuestionKey: text('consent_question_key'),
    consentTextVersion: text('consent_text_version'),
    consentChannels: text('consent_channels').array(),
    consentPurpose: text('consent_purpose'),
    pageTokenSealed: jsonb('page_token_sealed'),
    lastQuestionsJson: jsonb('last_questions_json').notNull().default([]),
    lastLeadAt: timestamp('last_lead_at', { withTimezone: true }),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'ingest_sources_provider_check',
      sql`${t.provider} in ('meta_leadgen', 'google_leadform', 'website')`,
    ),
    check(
      'ingest_sources_external_id_check',
      sql`${t.externalId} ~ '^[A-Za-z0-9_.:-]{1,200}$'`,
    ),
    check('ingest_sources_name_check', sql`char_length(${t.name}) between 1 and 80`),
    check(
      'ingest_sources_field_map_check',
      sql`jsonb_typeof(${t.fieldMapJson}) = 'object'`,
    ),
    check(
      'ingest_sources_consent_check',
      sql`(${t.consentQuestionKey} is null) = (${t.consentTextVersion} is null)
          and (${t.consentQuestionKey} is null) = (${t.consentChannels} is null)
          and (${t.consentQuestionKey} is null) = (${t.consentPurpose} is null)`,
    ),
    check(
      'ingest_sources_consent_question_check',
      sql`${t.consentQuestionKey} is null or char_length(${t.consentQuestionKey}) between 1 and 200`,
    ),
    check(
      'ingest_sources_consent_text_version_check',
      sql`${t.consentTextVersion} is null or char_length(${t.consentTextVersion}) between 1 and 60`,
    ),
    check(
      'ingest_sources_consent_channels_check',
      sql`${t.consentChannels} is null or (cardinality(${t.consentChannels}) between 1 and 4
          and ${t.consentChannels} <@ array['whatsapp', 'call', 'sms', 'email']::text[])`,
    ),
    check(
      'ingest_sources_consent_purpose_check',
      sql`${t.consentPurpose} is null or ${t.consentPurpose} in ('service', 'promotional')`,
    ),
    // Only a Meta form is fetched with a Page token.
    check(
      'ingest_sources_page_token_check',
      sql`${t.pageTokenSealed} is null or ${t.provider} = 'meta_leadgen'`,
    ),
    check(
      'ingest_sources_last_questions_check',
      sql`jsonb_typeof(${t.lastQuestionsJson}) = 'array'`,
    ),
    // A delivery is routed to its company by the form it names: one live connection per form.
    uniqueIndex('ingest_sources_external_unique')
      .on(t.provider, t.externalId)
      .where(sql`${t.archivedAt} is null`),
    index('ingest_sources_entity_idx').on(t.entityId, t.provider, t.name),
    index('ingest_sources_pipeline_idx').on(t.pipelineId),
  ],
);

/**
 * A company's key for the website ingest API (`POST /api/v1/ingest/leads`, docs/06-api.md §3.3):
 * only its SHA-256 is stored (`key_hash`, never selectable by a request role), and the key is
 * shown once when it is made (`crm.ingest_key.create`). `key_hint` is its last four characters, so
 * the screen tells keys apart. A revoked key stays revoked; `last_used_at` is written by the route's
 * lookup (`app.ingest_key_use()`).
 */
export const ingestKeys = pgTable(
  'ingest_keys',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    label: text('label').notNull(),
    keyHash: text('key_hash').notNull(),
    keyHint: text('key_hint').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    check('ingest_keys_label_check', sql`char_length(${t.label}) between 1 and 80`),
    check('ingest_keys_key_hash_check', sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
    check('ingest_keys_key_hint_check', sql`${t.keyHint} ~ '^[A-Za-z0-9_-]{4}$'`),
    check(
      'ingest_keys_revoked_check',
      sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`,
    ),
    uniqueIndex('ingest_keys_key_hash_unique').on(t.keyHash),
    index('ingest_keys_entity_idx').on(t.entityId, t.createdAt.desc()),
  ],
);

/**
 * The qualification facts a lead carries (docs/03-roadmap-appendix/phase2.md §6.2), one row per
 * lead, read and written with the lead: a form's mapped answers when the lead arrives, then
 * `crm.lead.qualification.set` from the lead sheet. A stage may require any of the five measures
 * (`RECORDED_STAGE_EXIT_FIELDS`). A child of `opportunities` with the composite key to the lead's
 * `(id, entity_id)`, so a fact never sits in another company.
 */
export const leadQualifications = pgTable(
  'lead_qualifications',
  {
    opportunityId: uuid('opportunity_id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    pumpDepthFt: integer('pump_depth_ft'),
    requiredHp: numeric('required_hp', { precision: 6, scale: 2 }),
    monthlyBillRupees: numeric('monthly_bill_rupees', { precision: 14, scale: 2 }),
    roofAreaSqFt: integer('roof_area_sq_ft'),
    sanctionedLoadKw: numeric('sanctioned_load_kw', { precision: 8, scale: 2 }),
    discomConsumerNo: text('discom_consumer_no'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    foreignKey({
      name: 'lead_qualifications_opportunity_fk',
      columns: [t.opportunityId, t.entityId],
      foreignColumns: [opportunities.id, opportunities.entityId],
    }),
    check(
      'lead_qualifications_pump_depth_check',
      sql`${t.pumpDepthFt} is null or ${t.pumpDepthFt} between 1 and 5000`,
    ),
    check(
      'lead_qualifications_required_hp_check',
      sql`${t.requiredHp} is null or ${t.requiredHp} between 0.5 and 500`,
    ),
    check(
      'lead_qualifications_monthly_bill_check',
      sql`${t.monthlyBillRupees} is null or ${t.monthlyBillRupees} between 1 and 100000000`,
    ),
    check(
      'lead_qualifications_roof_area_check',
      sql`${t.roofAreaSqFt} is null or ${t.roofAreaSqFt} between 1 and 10000000`,
    ),
    check(
      'lead_qualifications_sanctioned_load_check',
      sql`${t.sanctionedLoadKw} is null or ${t.sanctionedLoadKw} between 0.1 and 100000`,
    ),
    check(
      'lead_qualifications_discom_consumer_no_check',
      sql`${t.discomConsumerNo} is null or ${t.discomConsumerNo} ~ '^[A-Za-z0-9/-]{4,30}$'`,
    ),
    index('lead_qualifications_entity_idx').on(t.entityId),
  ],
);
