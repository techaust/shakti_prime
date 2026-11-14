import {
  ArchiveIngestSourceInput,
  CreateIngestKeyInput,
  DomainError,
  IngestKeyDto,
  IngestSourceConsentSchema,
  IngestSourceDto,
  IngestSourceProviderSchema,
  newId,
  RevokeIngestKeyInput,
  SetIngestSourceInput,
  SourceQuestionSchema,
  type IngestSourceConsent,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from './opportunity-shared';

/**
 * Settings › Lead sources (docs/03-roadmap-appendix/phase2.md §6.2): an Executive connects a
 * company's Lead Ads forms, Google lead forms and websites (`ingest_sources`) and makes and revokes
 * its website ingest keys (`ingest_keys`), with `crm.sources.write`. People only: an agent never
 * changes where leads come from. A Meta Page token is sealed by the field cipher before it is
 * stored, never read back, audited or answered; a website key is made by the caller and only its
 * hash reaches the command.
 */

const s = schema.ingestSources;

/** Every column a request may read of a source (the sealed token is not one of them). */
const SOURCE_COLUMNS = {
  id: s.id,
  entityId: s.entityId,
  provider: s.provider,
  externalId: s.externalId,
  name: s.name,
  pipelineId: s.pipelineId,
  fieldMapJson: s.fieldMapJson,
  consentQuestionKey: s.consentQuestionKey,
  consentTextVersion: s.consentTextVersion,
  consentChannels: s.consentChannels,
  consentPurpose: s.consentPurpose,
  pageTokenSet: s.pageTokenSet,
  lastQuestionsJson: s.lastQuestionsJson,
  lastLeadAt: s.lastLeadAt,
  archivedAt: s.archivedAt,
};

type SourceRow = {
  [K in keyof typeof SOURCE_COLUMNS]: (typeof s.$inferSelect)[K];
};

const Questions = z.array(SourceQuestionSchema);

function consentOf(row: SourceRow): IngestSourceConsent | null {
  if (row.consentQuestionKey === null) return null;
  return IngestSourceConsentSchema.parse({
    questionKey: row.consentQuestionKey,
    textVersion: row.consentTextVersion,
    channels: row.consentChannels,
    purpose: row.consentPurpose,
  });
}

/** The source as Settings › Lead sources shows it. */
export function toIngestSourceDto(row: SourceRow): IngestSourceDto {
  const questions = Questions.safeParse(row.lastQuestionsJson);
  return IngestSourceDto.parse({
    id: row.id,
    entityId: row.entityId,
    provider: IngestSourceProviderSchema.parse(row.provider),
    externalId: row.externalId,
    name: row.name,
    pipelineId: row.pipelineId,
    fieldMap: row.fieldMapJson,
    consent: consentOf(row),
    pageTokenSet: row.pageTokenSet,
    lastQuestions: questions.success ? questions.data : [],
    lastLeadAt: row.lastLeadAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  });
}

/** What the audit row shows of a source: never the Page token, only whether one is recorded. */
function audited(row: SourceRow) {
  return {
    provider: row.provider,
    externalId: row.externalId,
    name: row.name,
    pipelineId: row.pipelineId,
    fieldMap: row.fieldMapJson,
    consent: consentOf(row),
    pageTokenSet: row.pageTokenSet,
  };
}

function sourceMissing(): DomainError {
  return new DomainError('not_found', 'the lead source is not live in this company', {
    reason: 'lead_source_missing',
  });
}

/** The pipeline must be live and the company's or the group's. */
async function requirePipeline(
  ctx: CommandContext,
  entityId: number,
  pipelineId: string,
): Promise<void> {
  const p = schema.pipelines;
  const [pipeline] = await ctx.tx
    .select({ id: p.id })
    .from(p)
    .where(
      and(
        eq(p.id, pipelineId),
        eq(p.isActive, true),
        or(isNull(p.entityId), eq(p.entityId, entityId)),
      ),
    )
    .limit(1);
  if (!pipeline) {
    throw new DomainError('validation_failed', `pipeline ${pipelineId} is not offered`, {
      reason: 'lead_pipeline_missing',
      issues: [{ path: 'pipelineId', message: 'lead_pipeline_missing' }],
    });
  }
}

/**
 * `crm.source.set`: connects a form, Page or site to a company, or changes the connection's name,
 * pipeline, field map, consent question or Page token. A form is connected to one company at a time
 * (`lead_source_taken`); a connection keeps its provider and external id (`lead_source_fixed`).
 */
export const setIngestSource = defineCommand({
  name: 'crm.source.set',
  permission: 'crm.sources.write',
  minScope: 'all',
  peopleOnly: true,
  input: SetIngestSourceInput,
  output: IngestSourceDto,
  auditFields: ['provider', 'externalId', 'name', 'fieldMap', 'consent', 'pageTokenSet'],
  unmaskedFields: [
    // A form or Page id is a long number by design, kept whole.
    'externalId',
    // A form's own names for its questions, matched whole against what the form sends.
    'fieldMap',
    'consent.questionKey',
    // The Page's access token, sealed whole; masking would break it.
    'pageToken',
  ],
  // The token never reaches the audit row: only whether one was sent.
  auditInput: ({ pageToken, ...rest }) => ({ ...rest, pageToken: pageToken !== undefined }),
  constraintReasons: { ingest_sources_external_unique: 'lead_source_taken' },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    await requirePipeline(ctx, input.entityId, input.pipelineId);
    const id = input.sourceId ?? newId();
    // Sealed before any row is locked: the key service is a network call.
    let sealed: unknown;
    if (input.pageToken !== undefined) {
      if (ctx.fieldCipher === undefined) {
        throw new DomainError('integration_unavailable', 'no field cipher on this runtime');
      }
      sealed = await ctx.fieldCipher.encrypt(input.pageToken, {
        table: 'ingest_sources',
        column: 'page_token_sealed',
        entityId: input.entityId,
        rowId: id,
      });
    }
    const consent = {
      consentQuestionKey: input.consent?.questionKey ?? null,
      consentTextVersion: input.consent?.textVersion ?? null,
      consentChannels: input.consent?.channels ?? null,
      consentPurpose: input.consent?.purpose ?? null,
    };

    if (input.sourceId === undefined) {
      const [row] = await ctx.tx
        .insert(s)
        .values({
          id,
          entityId: input.entityId,
          provider: input.provider,
          externalId: input.externalId,
          name: input.name,
          pipelineId: input.pipelineId,
          fieldMapJson: input.fieldMap,
          ...consent,
          ...(sealed === undefined ? {} : { pageTokenSealed: sealed }),
          createdBy: ctx.principal.id,
        })
        .returning(SOURCE_COLUMNS);
      if (!row) throw new DomainError('internal', 'lead source insert returned no row');
      ctx.audit({
        aggregateType: 'ingest_source',
        aggregateId: row.id,
        entityId: row.entityId,
        before: null,
        after: audited(row),
      });
      return toIngestSourceDto(row);
    }

    const [before] = await ctx.tx
      .select(SOURCE_COLUMNS)
      .from(s)
      .where(and(eq(s.id, id), eq(s.entityId, input.entityId), isNull(s.archivedAt)))
      .limit(1)
      .for('update');
    if (!before) throw sourceMissing();
    if (before.provider !== input.provider || before.externalId !== input.externalId) {
      throw new DomainError('validation_failed', 'a lead source keeps its form', {
        reason: 'lead_source_fixed',
        issues: [{ path: 'externalId', message: 'lead_source_fixed' }],
      });
    }
    const [row] = await ctx.tx
      .update(s)
      .set({
        name: input.name,
        pipelineId: input.pipelineId,
        fieldMapJson: input.fieldMap,
        ...consent,
        ...(sealed === undefined ? {} : { pageTokenSealed: sealed }),
        updatedBy: ctx.principal.id,
      })
      .where(eq(s.id, id))
      .returning(SOURCE_COLUMNS);
    if (!row) throw sourceMissing();
    ctx.audit({
      aggregateType: 'ingest_source',
      aggregateId: row.id,
      entityId: row.entityId,
      before: audited(before),
      after: audited(row),
    });
    return toIngestSourceDto(row);
  },
});

/**
 * `crm.source.archive`: disconnects a form, Page or site; its leads keep their source, and a
 * delivery for the form afterwards is stored and reported as unmapped, never guessed.
 */
export const archiveIngestSource = defineCommand({
  name: 'crm.source.archive',
  permission: 'crm.sources.write',
  minScope: 'all',
  peopleOnly: true,
  input: ArchiveIngestSourceInput,
  output: IngestSourceDto,
  auditFields: ['archivedAt'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const [row] = await ctx.tx
      .update(s)
      .set({ archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(and(eq(s.id, input.sourceId), eq(s.entityId, input.entityId), isNull(s.archivedAt)))
      .returning(SOURCE_COLUMNS);
    if (!row) throw sourceMissing();
    ctx.audit({
      aggregateType: 'ingest_source',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { archivedAt: null },
      after: { archivedAt: ctx.now.toISOString() },
    });
    return toIngestSourceDto(row);
  },
});

const k = schema.ingestKeys;

/** Every column a request may read of a key (the hash is not one of them). */
const KEY_COLUMNS = {
  id: k.id,
  entityId: k.entityId,
  label: k.label,
  keyHint: k.keyHint,
  lastUsedAt: k.lastUsedAt,
  revokedAt: k.revokedAt,
  createdAt: k.createdAt,
};

type KeyRow = { [K in keyof typeof KEY_COLUMNS]: (typeof k.$inferSelect)[K] };

/** The key as Settings › Lead sources lists it: its label and last four characters. */
export function toIngestKeyDto(row: KeyRow): IngestKeyDto {
  return IngestKeyDto.parse({
    id: row.id,
    entityId: row.entityId,
    label: row.label,
    keyHint: row.keyHint,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * `crm.ingest_key.create`: records a website key of a company by its hash and last four
 * characters. The caller made the key (`newIngestKey()`) and shows it once.
 */
export const createIngestKey = defineCommand({
  name: 'crm.ingest_key.create',
  permission: 'crm.sources.write',
  minScope: 'all',
  peopleOnly: true,
  input: CreateIngestKeyInput,
  output: IngestKeyDto,
  auditFields: ['label', 'keyHint'],
  unmaskedFields: [
    // A SHA-256 in hexadecimal, stored whole and matched whole.
    'keyHash',
  ],
  // The hash is matched against what a website sends; the audit row needs only the label and hint.
  auditInput: (input) => ({ entityId: input.entityId, label: input.label, keyHint: input.keyHint }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const [row] = await ctx.tx
      .insert(k)
      .values({
        id: newId(),
        entityId: input.entityId,
        label: input.label,
        keyHash: input.keyHash,
        keyHint: input.keyHint,
        createdBy: ctx.principal.id,
      })
      .returning(KEY_COLUMNS);
    if (!row) throw new DomainError('internal', 'ingest key insert returned no row');
    ctx.audit({
      aggregateType: 'ingest_key',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: { label: row.label, keyHint: row.keyHint },
    });
    return toIngestKeyDto(row);
  },
});

/** `crm.ingest_key.revoke`: a website can no longer send leads with the key; it stays revoked. */
export const revokeIngestKey = defineCommand({
  name: 'crm.ingest_key.revoke',
  permission: 'crm.sources.write',
  minScope: 'all',
  peopleOnly: true,
  input: RevokeIngestKeyInput,
  output: IngestKeyDto,
  auditFields: ['revokedAt'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const [row] = await ctx.tx
      .update(k)
      .set({ revokedAt: ctx.now, revokedBy: ctx.principal.id })
      .where(and(eq(k.id, input.keyId), eq(k.entityId, input.entityId), isNull(k.revokedAt)))
      .returning(KEY_COLUMNS);
    if (!row) {
      throw new DomainError('not_found', 'the key is not live in this company', {
        reason: 'ingest_key_missing',
      });
    }
    ctx.audit({
      aggregateType: 'ingest_key',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { revokedAt: null },
      after: { revokedAt: ctx.now.toISOString() },
    });
    return toIngestKeyDto(row);
  },
});
