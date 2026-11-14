import { z } from 'zod';
import { ConsentChannelSchema, ConsentPurposeSchema } from '../../crm/enums';
import { EntityIdSchema, IdSchema } from '../../ids';
import { LEAD_QUALIFICATION_FACTS } from './ingest';

/**
 * Settings › Lead sources (docs/03-roadmap-appendix/phase2.md §6.2): each company's connected Lead
 * Ads forms, Google lead forms and websites (`ingest_sources`), and the website's ingest keys
 * (`ingest_keys`). Written by an Executive (`crm.sources.write`), never by an agent.
 */

export const INGEST_SOURCE_PROVIDERS = ['meta_leadgen', 'google_leadform', 'website'] as const;
export const IngestSourceProviderSchema = z.enum(INGEST_SOURCE_PROVIDERS);
export type IngestSourceProvider = z.infer<typeof IngestSourceProviderSchema>;

/**
 * What a form's question fills on the lead: the person's name (whole, or first and last), their
 * phone, the site's PIN and village, the message, or a qualification fact. A question the map
 * does not name is not read.
 */
export const INGEST_FIELD_TARGETS = [
  'fullName',
  'firstName',
  'lastName',
  'phone',
  'pin',
  'village',
  'message',
  ...LEAD_QUALIFICATION_FACTS,
] as const;
export const IngestFieldTargetSchema = z.enum(INGEST_FIELD_TARGETS);
export type IngestFieldTarget = z.infer<typeof IngestFieldTargetSchema>;

/** A form's own name for a question (Meta's field name, Google's column id). */
export const QuestionKeySchema = z.string().trim().min(1).max(200);

/** Each question of the form to what it fills, at most fifty. */
export const IngestFieldMapSchema = z
  .record(QuestionKeySchema, IngestFieldTargetSchema)
  .refine((m) => Object.keys(m).length <= 50, { message: 'at most fifty questions' });
export type IngestFieldMap = z.infer<typeof IngestFieldMapSchema>;

/** The form's consent question, the version of its wording, and what a tick consents to. */
export const IngestSourceConsentSchema = z
  .object({
    questionKey: QuestionKeySchema,
    textVersion: z.string().trim().min(1).max(60),
    channels: z.array(ConsentChannelSchema).min(1).max(4),
    purpose: ConsentPurposeSchema,
  })
  .strict()
  .refine((c) => new Set(c.channels).size === c.channels.length, {
    message: 'each channel once',
    path: ['channels'],
  });
export type IngestSourceConsent = z.infer<typeof IngestSourceConsentSchema>;

/** A form or Page id as the provider gives it, or a website's host name. */
export const SourceExternalIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,200}$/);

/**
 * `crm.source.set`: connects a form, Page or site to a company (no `sourceId`), or changes a
 * connection (`sourceId`; its provider and external id stay as they are). `pageToken` is the Meta
 * Page's access token, sealed before it is stored and never shown again; left out, the stored one
 * stays. `consent: null` takes the consent question away.
 */
export const SetIngestSourceInput = z
  .object({
    entityId: EntityIdSchema,
    sourceId: IdSchema.optional(),
    provider: IngestSourceProviderSchema,
    externalId: SourceExternalIdSchema,
    name: z.string().trim().min(1).max(80),
    pipelineId: IdSchema,
    fieldMap: IngestFieldMapSchema,
    consent: IngestSourceConsentSchema.nullable(),
    pageToken: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.|=+/-]{20,1000}$/)
      .optional(),
  })
  .strict()
  .refine((v) => v.pageToken === undefined || v.provider === 'meta_leadgen', {
    message: 'only a Lead Ads form has a Page token',
    path: ['pageToken'],
  });
export type SetIngestSourceInput = z.infer<typeof SetIngestSourceInput>;

export const ArchiveIngestSourceInput = z
  .object({ entityId: EntityIdSchema, sourceId: IdSchema })
  .strict();
export type ArchiveIngestSourceInput = z.infer<typeof ArchiveIngestSourceInput>;

/** A question the form asked in its newest lead, for the field map's preview. */
export const SourceQuestionSchema = z
  .object({ key: QuestionKeySchema, label: z.string().max(200).nullable() })
  .strict();

export const IngestSourceDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    provider: IngestSourceProviderSchema,
    externalId: z.string(),
    name: z.string(),
    pipelineId: IdSchema,
    fieldMap: z.record(z.string(), IngestFieldTargetSchema),
    consent: IngestSourceConsentSchema.nullable(),
    pageTokenSet: z.boolean(),
    lastQuestions: z.array(SourceQuestionSchema),
    lastLeadAt: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type IngestSourceDto = z.infer<typeof IngestSourceDto>;

/** A website key's SHA-256, as `ingest_keys.key_hash` keeps it. */
export const IngestKeyHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** The last four characters of a key, so the screen tells keys apart. */
export const IngestKeyHintSchema = z.string().regex(/^[A-Za-z0-9_-]{4}$/);

/**
 * `crm.ingest_key.create`: the key itself is made by the caller (`newIngestKey()`), shown to the
 * Executive once and never sent to the command, which stores only its hash and last four
 * characters; so no audit row, stored answer or log line ever holds it.
 */
export const CreateIngestKeyInput = z
  .object({
    entityId: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    keyHash: IngestKeyHashSchema,
    keyHint: IngestKeyHintSchema,
  })
  .strict();
export type CreateIngestKeyInput = z.infer<typeof CreateIngestKeyInput>;

export const RevokeIngestKeyInput = z
  .object({ entityId: EntityIdSchema, keyId: IdSchema })
  .strict();
export type RevokeIngestKeyInput = z.infer<typeof RevokeIngestKeyInput>;

export const IngestKeyDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    label: z.string(),
    keyHint: IngestKeyHintSchema,
    lastUsedAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type IngestKeyDto = z.infer<typeof IngestKeyDto>;
