import { CreateImportJobInput, DomainError, ImportJobDto, newId } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope, toImportJobDto } from './shared';

/** Rows written per statement: well inside Postgres's limit on parameters. */
const INSERT_CHUNK = 1000;

/**
 * `imports.job.create` (IMP-01): the uploaded file's record, the job in `uploaded`, and one
 * pending row per data row of the file with what the file said. The server action parses the
 * bytes before and stores them after the commit; the audit row records the file and the counts,
 * never the rows, which carry customers' names and numbers in columns the redaction cannot
 * recognise. The same file (bucket and key, named by its content) cannot start a second job.
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
    format: input.format,
    file: {
      name: input.file.name,
      contentType: input.file.contentType,
      size: input.file.size,
      sha256: input.file.sha256,
    },
    columns: input.columns.length,
    rows: input.rows.length,
  }),
  constraintReasons: { files_bucket_key_unique: 'import_file_duplicate' },
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const actor = ctx.principal.id;
    const fileId = newId();

    // No `returning`: the file row is read back with the job below.
    await ctx.tx.insert(schema.files).values({
      id: fileId,
      entityId: input.entityId,
      purpose: 'import',
      bucket: input.file.bucket,
      key: input.file.key,
      name: input.file.name,
      contentType: input.file.contentType,
      size: input.file.size,
      sha256: input.file.sha256,
      status: 'ready',
      createdBy: actor,
    });

    const [job] = await ctx.tx
      .insert(schema.importJobs)
      .values({
        id: newId(),
        entityId: input.entityId,
        kind: input.kind,
        fileId,
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
        fileId,
        format: job.format,
        totalRows: job.totalRows,
      },
    });

    return toImportJobDto({
      job,
      file: { id: fileId, name: input.file.name, size: input.file.size },
    });
  },
});
