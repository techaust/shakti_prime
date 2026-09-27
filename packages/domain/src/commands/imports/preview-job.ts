import {
  DomainError,
  ImportJobDto,
  PreviewImportJobInput,
  type ImportDedupeDto,
  type ImportRowErrorDto,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertImportJobMove } from '../../imports/job-state';
import { checkLeadRow, firstRowByPhone, type LeadRowLookups } from '../../imports/leads';
import {
  assertEntityInScope,
  jobState,
  loadJob,
  parseStoredMapping,
  toImportJobDto,
  updateJob,
} from './shared';

/** Rows updated, and phones looked up, per statement. */
const CHUNK = 1000;
/** Existing customers suggested per row, at most. */
const MAX_SUGGESTIONS = 5;

interface RowFinding {
  row_no: number;
  state: 'valid' | 'invalid' | 'skipped';
  normalised_json: unknown;
  errors_json: ImportRowErrorDto[];
  dedupe_json: ImportDedupeDto | null;
}

/** The pipelines and lead sources a row may name in this entity, as the caller sees them. */
async function lookups(tx: RequestTx, entityId: number): Promise<LeadRowLookups> {
  const p = schema.pipelines;
  const pipelines = await tx
    .select({ key: p.key })
    .from(p)
    .where(and(eq(p.isActive, true), or(isNull(p.entityId), eq(p.entityId, entityId))));
  const s = schema.leadSources;
  const sources = await tx.select({ code: s.code }).from(s).where(eq(s.isActive, true));
  return {
    pipelineKeys: new Set(pipelines.map((r) => r.key)),
    sourceCodes: new Set(sources.map((r) => r.code)),
  };
}

/** Customers the caller can see with each phone: the dedupe suggestions of design §8. */
async function existingByPhone(
  tx: RequestTx,
  phones: readonly string[],
): Promise<Map<string, ImportDedupeDto['existing']>> {
  const found = new Map<string, ImportDedupeDto['existing']>();
  const cp = schema.contactPhones;
  const ac = schema.accountContacts;
  const a = schema.accounts;
  const unique = [...new Set(phones)];
  for (let start = 0; start < unique.length; start += CHUNK) {
    const rows = await tx
      .select({ phone: cp.e164, contactId: cp.contactId, accountId: ac.accountId })
      .from(cp)
      .innerJoin(ac, eq(ac.contactId, cp.contactId))
      .innerJoin(a, and(eq(a.id, ac.accountId), isNull(a.archivedAt)))
      .where(inArray(cp.e164, unique.slice(start, start + CHUNK)))
      .orderBy(asc(cp.e164), asc(ac.accountId));
    for (const row of rows) {
      const list = found.get(row.phone) ?? [];
      const seen = list.some((m) => m.accountId === row.accountId && m.contactId === row.contactId);
      if (!seen && list.length < MAX_SUGGESTIONS) {
        list.push({ accountId: row.accountId, contactId: row.contactId });
      }
      found.set(row.phone, list);
    }
  }
  return found;
}

/**
 * `imports.job.preview` (IMP-01): every row through the `crm.lead.create` input and the
 * entity's pipelines and lead sources, with dedupe suggestions by phone. A repeat of an earlier
 * row of the same file is skipped; a match with an existing customer is only suggested, and the
 * row still imports as a new lead.
 */
export const previewImportJob = defineCommand({
  name: 'imports.job.preview',
  permission: 'imports.write',
  minScope: 'entity',
  input: PreviewImportJobInput,
  output: ImportJobDto,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    const before = jobState(loaded.job);
    assertImportJobMove(before, 'previewed');
    if (loaded.job.mappingJson === null) {
      throw new DomainError('conflict', 'the job has no mapping', { reason: 'import_job_state' });
    }
    const mapping = parseStoredMapping(loaded.job.mappingJson);
    const known = await lookups(ctx.tx, input.entityId);

    const r = schema.importRows;
    const rows = await ctx.tx
      .select({ rowNo: r.rowNo, raw: r.rawJson })
      .from(r)
      .where(eq(r.jobId, loaded.job.id))
      .orderBy(asc(r.rowNo));

    const checked = rows.map((row) => ({
      rowNo: row.rowNo,
      check: checkLeadRow(row.raw as Record<string, string>, mapping, input.entityId, known),
    }));
    const repeats = firstRowByPhone(checked.map((c) => ({ rowNo: c.rowNo, phone: c.check.phone })));
    const existing = await existingByPhone(
      ctx.tx,
      checked.flatMap((c) => (c.check.phone === null ? [] : [c.check.phone])),
    );

    const findings: RowFinding[] = checked.map(({ rowNo, check }) => {
      if (check.state === 'invalid') {
        return {
          row_no: rowNo,
          state: 'invalid',
          normalised_json: null,
          errors_json: check.errors,
          dedupe_json: null,
        };
      }
      const inFileRowNo = repeats.get(rowNo) ?? null;
      const matches = existing.get(check.phone) ?? [];
      return {
        row_no: rowNo,
        state: inFileRowNo === null ? 'valid' : 'skipped',
        normalised_json: check.input,
        errors_json: [],
        dedupe_json:
          inFileRowNo === null && matches.length === 0 ? null : { inFileRowNo, existing: matches },
      };
    });

    for (let start = 0; start < findings.length; start += CHUNK) {
      const chunk = JSON.stringify(findings.slice(start, start + CHUNK));
      await ctx.tx.execute(sql`
        update import_rows r
           set state = x.state, normalised_json = x.normalised_json, errors_json = x.errors_json,
               dedupe_json = x.dedupe_json, updated_by = ${ctx.principal.id}
          from jsonb_to_recordset(${chunk}::jsonb)
               as x(row_no int, state text, normalised_json jsonb, errors_json jsonb, dedupe_json jsonb)
         where r.job_id = ${loaded.job.id} and r.row_no = x.row_no`);
    }

    const count = (state: RowFinding['state']) => findings.filter((f) => f.state === state).length;
    const counts = {
      validRows: count('valid'),
      invalidRows: count('invalid'),
      skippedRows: count('skipped'),
    };
    const previewed = await updateJob(ctx.tx, loaded, {
      state: 'previewed',
      ...counts,
      updatedBy: ctx.principal.id,
    });

    ctx.audit({
      aggregateType: 'import_job',
      aggregateId: loaded.job.id,
      entityId: input.entityId,
      before: { state: before },
      after: {
        state: 'previewed',
        ...counts,
        suggested: findings.filter((f) => (f.dedupe_json?.existing.length ?? 0) > 0).length,
      },
    });

    return toImportJobDto(previewed);
  },
});
