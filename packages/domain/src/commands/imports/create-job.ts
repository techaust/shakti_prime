import { CreateImportJobInput, DomainError, ImportJobDto, newId } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import {
  assertContentNotImported,
  assertEntityInScope,
  assertGroupImport,
  toImportJobDto,
} from './shared';

/** Rows written per statement: well inside Postgres's limit on parameters. */
const INSERT_CHUNK = 1000;

/**
 * `imports.job.create` (IMP-01, docs/design/phase1.md §6.3): an import file the caller uploaded
 * through the pre-signed path, checked and `ready`, becomes a job in `uploaded` with one pending
 * row per data row of the file, as the server read it. Only the caller's own upload starts a job,
 * never a colleague's file of the company. One file starts one job (`import_jobs_file_unique`),
 * and a file whose content was already added in the company (a job adding it, done, or stopped
 * with rows added) is refused, so the same list is not imported twice; a job left before adding,
 * or undone, does not count; `imports.job.commit` asks the same again. The PIN code master is imported only by an
 * Executive in a request for every company. The audit row records the file and the counts, never
 * the rows, which carry customers' names and numbers in columns the redaction cannot recognise.
 */
export const createImportJob = defineCommand({
  name: 'imports.job.create',
  permission: 'imports.write',
  minScope: 'entity',
  input: CreateImportJobInput,
  output: ImportJobDto,
  auditFields: ['state', 'kind', 'format', 'totalRows'],
  auditInput: (input) => ({
    entityId: input.entityId,
    kind: input.kind,
    fileId: input.fileId,
    format: input.format,
    columns: input.columns.length,
    rows: input.rows.length,
  }),
  constraintReasons: { import_jobs_file_unique: 'import_file_duplicate' },
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    if (input.kind === 'pin_codes') await assertGroupImport(ctx);
    const actor = ctx.principal.id;

    const f = schema.files;
    const [file] = await ctx.tx
      .select({ id: f.id, name: f.name, size: f.size, sha256: f.sha256, status: f.status })
      .from(f)
      .where(
        and(
          eq(f.id, input.fileId),
          eq(f.entityId, input.entityId),
          eq(f.purpose, 'import'),
          eq(f.createdBy, actor),
        ),
      )
      .limit(1);
    if (!file) {
      throw new DomainError('not_found', 'the import file is not available', {
        reason: 'import_file_missing',
      });
    }
    if (file.status !== 'ready') {
      throw new DomainError('conflict', 'the import file has not passed its checks', {
        reason: 'import_file_not_ready',
      });
    }

    // The same content was already added in this company (another upload of the same file); the
    // commit asks again, since two jobs of one content may both be waiting by then.
    await assertContentNotImported(ctx.tx, input.entityId, file);
    const j = schema.importJobs;

    const [job] = await ctx.tx
      .insert(j)
      .values({
        id: newId(),
        entityId: input.entityId,
        kind: input.kind,
        fileId: file.id,
        format: input.format,
        columnsJson: input.columns,
        state: 'uploaded',
        totalRows: input.rows.length,
        createdBy: actor,
      })
      .returning();
    if (!job) throw new DomainError('internal', 'import job insert returned no row');

    for (let start = 0; start < input.rows.length; start += INSERT_CHUNK) {
      const chunk = input.rows.slice(start, start + INSERT_CHUNK);
      await ctx.tx.insert(schema.importRows).values(
        chunk.map((cells, i) => ({
          jobId: job.id,
          entityId: input.entityId,
          rowNo: start + i + 1,
          rawJson: Object.fromEntries(input.columns.map((c, k) => [c, cells[k] ?? ''])),
          createdBy: actor,
        })),
      );
    }

    ctx.audit({
      aggregateType: 'import_job',
      aggregateId: job.id,
      entityId: input.entityId,
      after: {
        state: job.state,
        kind: job.kind,
        fileId: file.id,
        format: job.format,
        totalRows: job.totalRows,
      },
    });

    return toImportJobDto({ job, file: { id: file.id, name: file.name, size: file.size } });
  },
});
