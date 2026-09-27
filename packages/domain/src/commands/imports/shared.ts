import {
  DomainError,
  ImportJobDto,
  ImportMappingSchema,
  type ImportJobState,
  type ImportMapping,
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
