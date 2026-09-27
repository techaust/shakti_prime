import {
  ImportRowDto,
  ImportRowPage,
  ImportTemplateDto,
  type GetImportJobInput,
  type ImportJobDto,
  type ListImportRowsInput,
  type ListImportTemplatesInput,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import {
  assertEntityInScope,
  loadJob,
  parseStoredMapping,
  toImportJobDto,
} from '../../commands/imports/shared';

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
  return ImportRowPage.parse({
    rows: page.map((row) =>
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
    ),
    nextAfter: rows.length > input.limit && last !== undefined ? last.rowNo : null,
  });
}

/** The saved mappings of one kind in one entity, by name. */
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
  return rows.map((row) =>
    ImportTemplateDto.parse({
      id: row.id,
      entityId: row.entityId,
      kind: row.kind,
      name: row.name,
      mapping: parseStoredMapping(row.mappingJson),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}
