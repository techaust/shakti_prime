import {
  DomainError,
  INGEST_CHANNELS,
  IngestSourceConsentSchema,
  IngestSourcesDto,
  ListIngestSourcesInput,
  ReadLeadQualificationInput,
  UNOWNED_LEADS_SHOWN,
  UnownedIngestLeadsDto,
  type IngestFieldTarget,
  type IngestSourceConsent,
  type IngestSourceProvider,
  type LeadQualificationDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  KEY_COLUMNS,
  SOURCE_COLUMNS,
  toIngestKeyDto,
  toIngestSourceDto,
} from '../../commands/crm/ingest-sources';
import { readQualification, toLeadQualificationDto } from '../../commands/crm/lead-qualification';
import { FieldEnvelopeSchema, type FieldEnvelope } from '../../privacy/field-cipher';

type Ctx = Pick<RequestContext, 'tx' | 'entityIds'>;

function requireCompany(ctx: Ctx, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/**
 * `crm.source.list`: one company's connected forms and sites, live ones first by name, and its
 * website keys, newest first, for Settings › Lead sources. Read under the tables' policies
 * (`crm.sources.write:all`); the sealed token and the key hash are never selected.
 */
export async function listIngestSources(ctx: Ctx, rawInput: unknown): Promise<IngestSourcesDto> {
  const input = ListIngestSourcesInput.parse(rawInput);
  requireCompany(ctx, input.entityId);
  const s = schema.ingestSources;
  const k = schema.ingestKeys;
  const [sources, keys] = await Promise.all([
    ctx.tx
      .select(SOURCE_COLUMNS)
      .from(s)
      .where(eq(s.entityId, input.entityId))
      .orderBy(sql`${s.archivedAt} is not null`, asc(s.provider), asc(s.name), asc(s.id))
      .limit(200),
    ctx.tx
      .select(KEY_COLUMNS)
      .from(k)
      .where(eq(k.entityId, input.entityId))
      .orderBy(desc(k.createdAt), desc(k.id))
      .limit(200),
  ]);
  return IngestSourcesDto.parse({
    sources: sources.map(toIngestSourceDto),
    keys: keys.map(toIngestKeyDto),
  });
}

/** A live connected form, Page or site, as the platform's lead handlers read it. */
export interface FoundIngestSource {
  sourceId: string;
  entityId: number;
  pipelineKey: string;
  segment: string;
  fieldMap: Record<string, IngestFieldTarget>;
  consent: IngestSourceConsent | null;
  hasPageToken: boolean;
}

interface SourceRow {
  source_id: string;
  entity_id: number;
  pipeline_key: string;
  segment: string;
  field_map_json: Record<string, IngestFieldTarget>;
  consent_question_key: string | null;
  consent_text_version: string | null;
  consent_channels: string[] | null;
  consent_purpose: string | null;
  has_page_token: boolean;
}

/**
 * The platform's lookup of a form by its provider and id (`app.ingest_source()`, `crm.ingest.run`):
 * which company it belongs to, with no company in the request, since a delivery names none.
 */
export async function findIngestSource(
  ctx: Ctx,
  provider: IngestSourceProvider,
  externalId: string,
): Promise<FoundIngestSource | undefined> {
  const [row] = (await ctx.tx.execute(
    sql`select source_id, entity_id, pipeline_key, segment, field_map_json, consent_question_key,
               consent_text_version, consent_channels, consent_purpose, has_page_token
          from app.ingest_source(${provider}::text, ${externalId}::text)`,
  )) as unknown as SourceRow[];
  if (row === undefined) return undefined;
  const consent =
    row.consent_question_key === null
      ? null
      : IngestSourceConsentSchema.parse({
          questionKey: row.consent_question_key,
          textVersion: row.consent_text_version,
          channels: row.consent_channels,
          purpose: row.consent_purpose,
        });
  return {
    sourceId: row.source_id,
    entityId: row.entity_id,
    pipelineKey: row.pipeline_key,
    segment: row.segment,
    fieldMap: row.field_map_json,
    consent,
    hasPageToken: row.has_page_token,
  };
}

/** The sealed Page token of a live Meta connection of the request's company, for the handler. */
export async function ingestSourceToken(
  ctx: Ctx,
  sourceId: string,
): Promise<FieldEnvelope | undefined> {
  const [row] = (await ctx.tx.execute(
    sql`select app.ingest_source_token(${sourceId}::uuid) as token`,
  )) as unknown as { token: unknown }[];
  const parsed = FieldEnvelopeSchema.safeParse(row?.token);
  return parsed.success ? parsed.data : undefined;
}

/** The website route's key by its hash: its id and company, or undefined (unknown or revoked). */
export async function findIngestKey(
  ctx: Ctx,
  keyHash: string,
): Promise<{ keyId: string; entityId: number; entityCode: string } | undefined> {
  const [row] = (await ctx.tx.execute(
    sql`select key_id, entity_id, entity_code from app.ingest_key_find(${keyHash}::text)`,
  )) as unknown as { key_id: string; entity_id: number; entity_code: string }[];
  return row === undefined
    ? undefined
    : { keyId: row.key_id, entityId: row.entity_id, entityCode: row.entity_code };
}

/**
 * Integration health's open leads from an integration that nobody owns, in the request's
 * companies, newest first, under the caller's own lead policies: a company with no caller present
 * and no Sales Team Lead leaves them unassigned (`crm.lead.ingest`), and this list keeps them seen.
 * Served by `opportunities_entity_owner_idx` (owner null).
 */
export async function listUnownedIngestLeads(ctx: Ctx): Promise<UnownedIngestLeadsDto> {
  const o = schema.opportunities;
  const ls = schema.leadSources;
  const where = and(
    inArray(o.entityId, [...ctx.entityIds]),
    isNull(o.ownerId),
    eq(o.state, 'open'),
    isNull(o.archivedAt),
    inArray(ls.code, [...INGEST_CHANNELS]),
  );
  const [rows, [total]] = await Promise.all([
    ctx.tx
      .select({
        id: o.id,
        entityId: o.entityId,
        accountId: o.accountId,
        channel: ls.code,
        createdAt: o.createdAt,
      })
      .from(o)
      .innerJoin(ls, eq(ls.id, o.sourceId))
      .where(where)
      .orderBy(desc(o.createdAt), desc(o.id))
      .limit(UNOWNED_LEADS_SHOWN),
    ctx.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(o)
      .innerJoin(ls, eq(ls.id, o.sourceId))
      .where(where),
  ]);
  return UnownedIngestLeadsDto.parse({
    total: total?.n ?? 0,
    items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
}

/** `crm.lead.qualification.read`: the lead's facts as the card shows them, under its read rule. */
export async function readLeadQualification(
  ctx: Ctx,
  rawInput: unknown,
): Promise<LeadQualificationDto> {
  const input = ReadLeadQualificationInput.parse(rawInput);
  requireCompany(ctx, input.entityId);
  const o = schema.opportunities;
  const [lead] = await ctx.tx
    .select({ id: o.id, entityId: o.entityId })
    .from(o)
    .where(and(eq(o.id, input.opportunityId), eq(o.entityId, input.entityId)))
    .limit(1);
  if (!lead) {
    throw new DomainError('not_found', `opportunity ${input.opportunityId} is not visible`, {
      reason: 'lead_missing',
    });
  }
  const row = await readQualification(ctx, lead.id);
  return toLeadQualificationDto({ opportunityId: lead.id, entityId: lead.entityId }, row);
}
