import { ImportIdentityCheckDto, MaskImportIdentityInput } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { maskIdentityValue, withoutIdentityNumbers } from '../../imports/identity-columns';
import { assertEntityInScope } from './shared';

interface JobToCheck {
  jobId: string;
  columns: string[];
  rows: { rowNo: number; raw: Record<string, string>; normalised: unknown }[];
}

/**
 * `imports.job.mask_identity` (audit SEC-1): the one-off pass over the import jobs made before
 * the identity-number rule, which still hold what the client's file said. One call takes the
 * oldest such job of one company that is not adding rows (`app.import_job_to_check()`, which holds
 * it), applies the rule the import now applies at its start (`withoutIdentityNumbers`: a column of
 * Aadhaar numbers left out of every row and of the job's columns, any other Aadhaar number masked
 * to its last four digits, in the rows' checked input as well), and writes back only the rows that
 * changed through `app.record_import_identity_check()`, which adds the columns left out and the
 * count masked to the job and marks it checked. Each row's state, what it made and why it was
 * refused are untouched, so the reconciliation stays as it was. It runs as the worker principal
 * (`imports.process`), call after call from the files sweep while `more`; once every job is
 * checked a call finds none. A job with something removed has one audit row of the counts.
 */
export const maskImportIdentity = defineCommand({
  name: 'imports.job.mask_identity',
  permission: 'imports.process',
  minScope: 'entity',
  input: MaskImportIdentityInput,
  output: ImportIdentityCheckDto,
  auditFields: ['leftOutColumns', 'maskedValues'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const [found] = (await ctx.tx.execute(
      sql`select app.import_job_to_check(${input.entityId}::smallint) as job`,
    )) as unknown as { job: JobToCheck | null }[];
    const job = found?.job ?? null;
    if (job === null) {
      return ImportIdentityCheckDto.parse({
        entityId: input.entityId,
        jobId: null,
        rows: 0,
        leftOutColumns: 0,
        maskedValues: 0,
        more: false,
      });
    }

    const clean = withoutIdentityNumbers(
      job.columns,
      job.rows.map((row) => job.columns.map((c) => row.raw[c] ?? '')),
    );
    let maskedValues = clean.maskedValues;
    const changed: JobToCheck['rows'] = [];
    job.rows.forEach((row, i) => {
      const cells = clean.rows[i] ?? [];
      // A row whose file text was already cleared (the anonymisation) stays empty.
      const cleared = Object.keys(row.raw).length === 0;
      const raw = cleared
        ? {}
        : Object.fromEntries(clean.columns.map((c, k) => [c, cells[k] ?? '']));
      const normalised = maskIdentityValue(row.normalised);
      maskedValues += normalised.masked;
      const rawChanged =
        !cleared && JSON.stringify(raw) !== JSON.stringify(rowRaw(row.raw, job.columns));
      if (rawChanged || normalised.masked > 0) {
        changed.push({ rowNo: row.rowNo, raw, normalised: normalised.value });
      }
    });

    const [written] = (await ctx.tx.execute(
      sql`select app.record_import_identity_check(${input.entityId}::smallint, ${job.jobId}::uuid,
                                                  ${JSON.stringify(clean.columns)}::jsonb,
                                                  ${`{${clean.leftOutColumns.map(arrayItem).join(',')}}`}::text[],
                                                  ${maskedValues}::integer,
                                                  ${JSON.stringify(changed)}::jsonb) as rows`,
    )) as unknown as { rows: number }[];
    const rows = written?.rows ?? 0;
    if (rows > 0 || clean.leftOutColumns.length > 0) {
      ctx.audit({
        aggregateType: 'import_job',
        aggregateId: job.jobId,
        entityId: input.entityId,
        after: { leftOutColumns: clean.leftOutColumns.length, maskedValues },
      });
    }
    return ImportIdentityCheckDto.parse({
      entityId: input.entityId,
      jobId: job.jobId,
      rows,
      leftOutColumns: clean.leftOutColumns.length,
      maskedValues,
      more: true,
    });
  },
});

/** A row's raw values in the job's column order, as the rebuilt row is written. */
function rowRaw(raw: Record<string, string>, columns: readonly string[]): Record<string, string> {
  return Object.fromEntries(columns.map((c) => [c, raw[c] ?? '']));
}

/** One element of a Postgres text array literal, quoted, with its quotes and backslashes escaped. */
function arrayItem(value: string): string {
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}
