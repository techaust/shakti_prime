import {
  IMPORT_IDENTITY_CHUNK,
  ImportIdentityCheckDto,
  ImportPurgeFailureDto,
  MaskImportIdentityInput,
  RecordImportPurgeFailureInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import {
  maskIdentityCells,
  maskIdentityText,
  maskIdentityValue,
  withoutIdentityNumbers,
} from '../../imports/identity-columns';
import { assertEntityInScope } from './shared';

interface PartToCheck {
  jobId: string;
  columns: string[];
  mapping: unknown;
  fileName: string | null;
  through: number;
  last: boolean;
  rows: { rowNo: number; raw: Record<string, string>; normalised: unknown }[];
}

/** Whether two rows say the same, whatever order their keys come in (jsonb keeps its own). */
function sameRaw(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => k in b && (b[k] ?? '') === (a[k] ?? ''))
  );
}

/** One element of a Postgres text array literal, quoted, with its quotes and backslashes escaped. */
function arrayItem(value: string): string {
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/**
 * `imports.job.mask_identity` (audit SEC-1, review M4): the one-off pass over the import jobs made
 * before the identity-number rule, which still hold what the client's file said. One call checks
 * the next `IMPORT_IDENTITY_CHUNK` rows of the named job of one company, held by
 * `app.import_job_to_check()` (a job another run holds, or one already checked, answers no job),
 * so a call never comes near the 30-second limits however large the job:
 * - the first part decides the columns by the rule the import now applies at its start
 *   (`withoutIdentityNumbers`): a column of Aadhaar numbers is left out of the job's columns and of
 *   every row, and the file's name and the saved mapping keep only the last four digits of a
 *   number in them;
 * - every part masks the run of digits holding an Aadhaar number in each cell, and in the rows'
 *   checked input, to its last four digits (`maskIdentityCells`, `maskIdentityValue`);
 * - only the rows that changed are written back, through `app.record_import_identity_check()`,
 *   which moves the pass's row on and, with the last part, marks the job checked.
 * Each row's state, what it made and why it was refused are untouched, so the reconciliation stays
 * as it was. It runs as the worker principal (`imports.process`), call after call from the files
 * sweep. A part that changed something has one audit row of the counts.
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
      sql`select app.import_job_to_check(${input.entityId}::smallint, ${input.jobId}::uuid,
                                         ${IMPORT_IDENTITY_CHUNK}::integer) as part`,
    )) as unknown as { part: PartToCheck | null }[];
    const part = found?.part ?? null;
    if (part === null) {
      return ImportIdentityCheckDto.parse({
        entityId: input.entityId,
        jobId: null,
        rows: 0,
        leftOutColumns: 0,
        maskedValues: 0,
        done: false,
      });
    }

    // A row whose file text was already cleared (the anonymisation, the purge) stays empty.
    const live = part.rows.filter((row) => Object.keys(row.raw).length > 0);
    const cells = live.map((row) => part.columns.map((c) => row.raw[c] ?? ''));
    const first = part.through === 0;
    const decided = first
      ? withoutIdentityNumbers(part.columns, cells)
      : { columns: part.columns, leftOutColumns: [], ...maskIdentityCells(part.columns, cells) };
    let maskedValues = decided.maskedValues;
    const masks = new Map(live.map((row, i) => [row.rowNo, decided.rows[i] ?? []]));
    const changed: PartToCheck['rows'] = [];
    for (const row of part.rows) {
      const normalised = maskIdentityValue(row.normalised);
      maskedValues += normalised.masked;
      const kept = masks.get(row.rowNo);
      const raw =
        kept === undefined
          ? row.raw
          : Object.fromEntries(decided.columns.map((c, k) => [c, kept[k] ?? '']));
      const rawChanged = kept !== undefined && !sameRaw(raw, row.raw);
      if (rawChanged || normalised.masked > 0) {
        changed.push({ rowNo: row.rowNo, raw, normalised: normalised.value });
      }
    }
    const fileName =
      first && part.fileName !== null && maskIdentityText(part.fileName) !== part.fileName
        ? maskIdentityText(part.fileName)
        : null;
    const through = part.rows.at(-1)?.rowNo ?? part.through;
    // A saved mapping names the file's columns, a left-out one's name included.
    const mapping = first && part.mapping !== null ? maskIdentityValue(part.mapping) : null;
    const maskedMapping = mapping !== null && mapping.masked > 0 ? mapping.value : null;

    const [written] = (await ctx.tx.execute(
      sql`select app.record_import_identity_check(
            ${input.entityId}::smallint, ${part.jobId}::uuid,
            ${JSON.stringify(decided.columns)}::jsonb,
            ${`{${decided.leftOutColumns.map(arrayItem).join(',')}}`}::text[],
            ${maskedValues}::integer, ${through}::integer, ${part.last}::boolean,
            ${fileName}::text,
            ${maskedMapping === null ? null : JSON.stringify(maskedMapping)}::jsonb,
            ${JSON.stringify(changed)}::jsonb) as rows`,
    )) as unknown as { rows: number }[];
    const rows = written?.rows ?? 0;
    if (rows > 0 || decided.leftOutColumns.length > 0 || fileName !== null) {
      ctx.audit({
        aggregateType: 'import_job',
        aggregateId: part.jobId,
        entityId: input.entityId,
        after: { leftOutColumns: decided.leftOutColumns.length, maskedValues },
      });
    }
    return ImportIdentityCheckDto.parse({
      entityId: input.entityId,
      jobId: part.jobId,
      rows,
      leftOutColumns: decided.leftOutColumns.length,
      maskedValues,
      done: part.last,
    });
  },
});

/**
 * `imports.purge.record_failure` (review M4): one call of the import purge failed in one company,
 * recorded in `retention_runs` by its code alone through `app.record_import_purge_failure()`, so
 * the jobs check and Integration Health see it; the worker passes the job by until its next hour
 * and goes on with the others. It runs as the worker principal (`imports.process`).
 */
export const recordImportPurgeFailure = defineCommand({
  name: 'imports.purge.record_failure',
  permission: 'imports.process',
  minScope: 'entity',
  input: RecordImportPurgeFailureInput,
  output: ImportPurgeFailureDto,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    await ctx.tx.execute(
      sql`select app.record_import_purge_failure(${input.entityId}::smallint, ${input.job}::text,
                                                 ${input.error}::text)`,
    );
    return ImportPurgeFailureDto.parse({ entityId: input.entityId, job: input.job });
  },
});
