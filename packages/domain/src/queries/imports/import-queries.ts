import {
  DomainError,
  IdSchema,
  ImportJobPage,
  ImportMappingSchema,
  ImportRowDto,
  ImportRowPage,
  ImportTemplateDto,
  type GetImportJobInput,
  type ImportJobDto,
  type ListImportJobsInput,
  type ListImportRowsInput,
  type ListImportTemplatesInput,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkPermission } from '../../command/run-command';
import { assertEntityInScope, loadJob, toImportJobDto } from '../../commands/imports/shared';

type QueryContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** Reads need the import permission, as the rows' policies do; the guard says so first. */
function guard(ctx: QueryContext, entityId: number): void {
  checkPermission(ctx.principal, 'imports.write', 'entity');
  assertEntityInScope(ctx.entityIds, entityId);
}

/** One import job as the import screens see it. */
export async function getImportJob(
  ctx: QueryContext,
  input: GetImportJobInput,
): Promise<ImportJobDto> {
  guard(ctx, input.entityId);
  return toImportJobDto(await loadJob(ctx.tx, input.entityId, input.jobId));
}

/** A job's rows in file order, optionally in one state, a page at a time. */
export async function listImportRows(
  ctx: QueryContext,
  input: ListImportRowsInput,
): Promise<ImportRowPage> {
  guard(ctx, input.entityId);
  // The job must be visible; its rows follow it.
  await loadJob(ctx.tx, input.entityId, input.jobId);
  const r = schema.importRows;
  const rows = await ctx.tx
    .select()
    .from(r)
    .where(
      and(
        eq(r.jobId, input.jobId),
        input.state === undefined ? undefined : eq(r.state, input.state),
        input.after === undefined ? undefined : gt(r.rowNo, input.after),
      ),
    )
    .orderBy(asc(r.rowNo))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const dtos = page.map((row) =>
    ImportRowDto.parse({
      rowNo: row.rowNo,
      state: row.state,
      raw: row.rawJson,
      errors: row.errorsJson,
      dedupe: row.dedupeJson,
      createdType: row.createdType,
      createdId: row.createdId,
      committedBatch: row.committedBatch,
    }),
  );
  return ImportRowPage.parse({
    rows: dtos,
    nextAfter: rows.length > input.limit && last !== undefined ? last.rowNo : null,
    customers: await customerNames(
      ctx,
      dtos.flatMap((row) => row.dedupe?.existing.map((e) => e.accountId) ?? []),
    ),
  });
}

/**
 * The names of the customers a page of dedupe suggestions points at. RLS on `accounts` decides:
 * a customer the caller can no longer see has no name here, and the screen says so plainly.
 */
async function customerNames(
  ctx: QueryContext,
  accountIds: readonly string[],
): Promise<Record<string, string>> {
  if (accountIds.length === 0) return {};
  const a = schema.accounts;
  const rows = await ctx.tx
    .select({ id: a.id, name: a.name })
    .from(a)
    .where(inArray(a.id, [...new Set(accountIds)]));
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

/** `created_at` is the Postgres text form of the timestamp, so no microsecond is lost. */
const JobCursorSchema = z
  .object({
    createdAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/),
    id: IdSchema,
  })
  .strict();

function decodeJobCursor(cursor: string): { createdAt: string; id: string } {
  try {
    return JobCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor });
  }
}

function encodeJobCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

/**
 * The import jobs of one company, or of every company of the request, newest first, keyset
 * paginated by `(created_at, id)` on the `(entity_id, created_at)` index. RLS decides the rows;
 * the people who started them are named from `principals`, which every signed-in person reads.
 */
export async function listImportJobs(
  ctx: QueryContext,
  input: ListImportJobsInput,
): Promise<ImportJobPage> {
  checkPermission(ctx.principal, 'imports.write', 'entity');
  if (input.entityId !== undefined) assertEntityInScope(ctx.entityIds, input.entityId);
  const entityIds = input.entityId === undefined ? [...ctx.entityIds] : [input.entityId];
  const after = input.cursor === undefined ? undefined : decodeJobCursor(input.cursor);
  const j = schema.importJobs;
  const f = schema.files;
  const p = schema.principals;
  const rows = await ctx.tx
    .select({
      job: j,
      file: { id: f.id, name: f.name, size: f.size },
      createdAtText: sql<string>`${j.createdAt}::text`,
      creator: p.displayName,
    })
    .from(j)
    .innerJoin(f, eq(f.id, j.fileId))
    .leftJoin(p, eq(p.id, j.createdBy))
    .where(
      and(
        inArray(j.entityId, entityIds),
        after === undefined
          ? undefined
          : or(
              lt(j.createdAt, sql`${after.createdAt}::timestamptz`),
              and(eq(j.createdAt, sql`${after.createdAt}::timestamptz`), lt(j.id, after.id)),
            ),
      ),
    )
    .orderBy(desc(j.createdAt), desc(j.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const creators: Record<string, string> = {};
  for (const row of page) {
    if (row.creator !== null) creators[row.job.createdBy] = row.creator;
  }
  return ImportJobPage.parse({
    items: page.map((row) => toImportJobDto({ job: row.job, file: row.file })),
    creators,
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeJobCursor(last.createdAtText, last.job.id)
        : null,
  });
}

/**
 * The saved mappings of one kind in one entity, by name. A template whose stored mapping no longer
 * fits the contract is left out rather than failing the whole list: the choice of templates is a
 * convenience, and one unreadable row must not stop an import (the commands still refuse to apply
 * it through `parseStoredMapping`).
 */
export async function listImportTemplates(
  ctx: QueryContext,
  input: ListImportTemplatesInput,
): Promise<ImportTemplateDto[]> {
  guard(ctx, input.entityId);
  const t = schema.importMappingTemplates;
  const rows = await ctx.tx
    .select()
    .from(t)
    .where(and(eq(t.entityId, input.entityId), eq(t.kind, input.kind)))
    .orderBy(asc(t.name));
  return rows.flatMap((row) => {
    const mapping = ImportMappingSchema.safeParse(row.mappingJson);
    if (!mapping.success) return [];
    return [
      ImportTemplateDto.parse({
        id: row.id,
        entityId: row.entityId,
        kind: row.kind,
        name: row.name,
        mapping: mapping.data,
        updatedAt: row.updatedAt.toISOString(),
      }),
    ];
  });
}
