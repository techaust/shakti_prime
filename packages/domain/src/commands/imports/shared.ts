import {
  DomainError,
  hasGrant,
  IMPLEMENTED_IMPORT_KINDS,
  ImportJobDto,
  ImportMappingSchema,
  importMappingSchemaFor,
  type AccountImportMapping,
  type ImplementedImportKind,
  type ImportJobState,
  type ImportMapping,
  type LeadImportMapping,
  type PermissionGrant,
  type PinCodeImportMapping,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';

type JobRow = typeof schema.importJobs.$inferSelect;
type FileRow = Pick<typeof schema.files.$inferSelect, 'id' | 'name' | 'size'>;

export interface LoadedJob {
  job: JobRow;
  file: FileRow;
}

/** The request must name the job's own entity, and the caller must be working in it. */
export function assertEntityInScope(entityIds: readonly number[], entityId: number): void {
  if (!entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/**
 * The companies a job's checked rows name (`import_jobs.entity_ids`) must all be in the request:
 * adding the rows writes a relationship in each, and undoing them must see each, so a request
 * that does not act for one of them is refused before anything is done.
 */
export function assertJobCompaniesCovered(
  entityIds: readonly number[],
  job: Pick<JobRow, 'entityIds'>,
): void {
  const missing = (job.entityIds ?? []).filter((id) => !entityIds.includes(id));
  if (missing.length > 0) {
    throw new DomainError('forbidden', 'the import names companies outside the request', {
      reason: 'import_companies_out_of_reach',
      entityIds: missing,
    });
  }
}

/**
 * The job and its file as the caller sees them. `lock` holds the job row until the transaction
 * ends, so two calls on one job (a double click, two batch workers) take turns.
 */
export async function loadJob(
  tx: RequestTx,
  entityId: number,
  jobId: string,
  lock = false,
): Promise<LoadedJob> {
  const j = schema.importJobs;
  const f = schema.files;
  const query = tx
    .select({ job: j, file: { id: f.id, name: f.name, size: f.size } })
    .from(j)
    .innerJoin(f, eq(f.id, j.fileId))
    .where(and(eq(j.id, jobId), eq(j.entityId, entityId)))
    .limit(1);
  const [row] = lock ? await query.for('update', { of: j }) : await query;
  if (!row) {
    throw new DomainError('not_found', 'import job is not available', {
      reason: 'import_job_missing',
    });
  }
  return row;
}

/** A stored mapping read back through its contract; a row that no longer fits is a fault. */
export function parseStoredMapping(value: unknown): ImportMapping {
  const parsed = ImportMappingSchema.safeParse(value);
  if (!parsed.success) throw new DomainError('internal', 'a stored import mapping is not valid');
  return parsed.data;
}

/** The mappings of each kind, as `importMappingSchemaFor` checks them. */
export interface KindMappings {
  leads: LeadImportMapping;
  accounts: AccountImportMapping;
  pin_codes: PinCodeImportMapping;
}

/** A job's mapping, read back under its own kind's rules; one that no longer fits is a fault. */
export function parseMappingFor<K extends ImplementedImportKind>(
  kind: K,
  value: unknown,
): KindMappings[K] {
  const parsed = importMappingSchemaFor(kind).safeParse(value);
  if (!parsed.success) throw new DomainError('internal', 'a stored import mapping is not valid');
  return parsed.data as KindMappings[K];
}

/** The job's kind; a job of a kind not implemented yet cannot exist, so one is a fault. */
export function implementedKind(job: JobRow): ImplementedImportKind {
  const kind = job.kind as ImplementedImportKind;
  if (!IMPLEMENTED_IMPORT_KINDS.includes(kind)) {
    throw new DomainError('internal', `import jobs of kind ${job.kind} are not implemented`);
  }
  return kind;
}

/**
 * The PIN code master is shared by every company, so only an Executive (`imports.write` at scope
 * all) in a request for every active company imports it (docs/design/phase1.md §6.3), as the
 * shared catalogue is changed; the write policies of `pin_codes` hold the same rule.
 */
export async function assertGroupImport(ctx: {
  tx: RequestTx;
  principal: { permissions: readonly PermissionGrant[] };
}): Promise<void> {
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (!hasGrant(ctx.principal.permissions, 'imports.write', 'all') || covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'the PIN code master needs every company in scope', {
      reason: 'import_needs_all_companies',
    });
  }
}

export function jobState(job: JobRow): ImportJobState {
  return job.state as ImportJobState;
}

/** Whitelists what leaves the command layer for an import job (AGENTS.md §5). */
export function toImportJobDto({ job, file }: LoadedJob): ImportJobDto {
  return ImportJobDto.parse({
    id: job.id,
    entityId: job.entityId,
    kind: job.kind,
    state: job.state,
    file: { id: file.id, name: file.name, size: file.size },
    format: job.format,
    templateId: job.templateId,
    columns: job.columnsJson,
    mapping: job.mappingJson === null ? null : parseStoredMapping(job.mappingJson),
    totalRows: job.totalRows,
    validRows: job.validRows,
    invalidRows: job.invalidRows,
    skippedRows: job.skippedRows,
    committedRows: job.committedRows,
    failedBatch: job.failedBatch,
    entityIds: job.entityIds,
    createdBy: job.createdBy,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}

/** Changes the job's working columns and answers the row as it now stands. */
export async function updateJob(
  tx: RequestTx,
  loaded: LoadedJob,
  changes: Partial<
    Pick<
      JobRow,
      | 'templateId'
      | 'mappingJson'
      | 'state'
      | 'validRows'
      | 'invalidRows'
      | 'skippedRows'
      | 'committedRows'
      | 'failedBatch'
      | 'batchCount'
      | 'entityIds'
      | 'updatedBy'
    >
  >,
): Promise<LoadedJob> {
  const j = schema.importJobs;
  const [job] = await tx.update(j).set(changes).where(eq(j.id, loaded.job.id)).returning();
  if (!job) throw new DomainError('internal', 'import job update returned no row');
  return { job, file: loaded.file };
}

/** Rows of a job in a given state. */
export async function countRows(tx: RequestTx, jobId: string, state: string): Promise<number> {
  const r = schema.importRows;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(r)
    .where(and(eq(r.jobId, jobId), eq(r.state, state)));
  return row?.n ?? 0;
}
