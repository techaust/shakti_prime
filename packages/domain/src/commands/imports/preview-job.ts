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
import {
  checkLeadRow,
  firstRowByPhone,
  nameVillageKey,
  type LeadRowLookups,
} from '../../imports/leads';
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
        list.push({ accountId: row.accountId, contactId: row.contactId, reason: 'phone' });
      }
      found.set(row.phone, list);
    }
  }
  return found;
}

function pairKey(pair: { name: string; village: string }): string {
  return `${pair.village}\u0000${pair.name}`;
}

/**
 * Customers the caller can see whose contact has the row's name and whose site is in the row's
 * village, compared through `matchKey` on both sides: the second dedupe suggestion of design §8,
 * for the many farmers a file lists without the number the office already has.
 */
async function existingByNameAndVillage(
  tx: RequestTx,
  pairs: readonly { name: string; village: string }[],
): Promise<Map<string, ImportDedupeDto['existing']>> {
  const found = new Map<string, ImportDedupeDto['existing']>();
  const unique = [...new Map(pairs.map((p) => [pairKey(p), p])).values()];
  for (let start = 0; start < unique.length; start += CHUNK) {
    const wanted = JSON.stringify(unique.slice(start, start + CHUNK));
    const rows = (await tx.execute(sql`
      with wanted as (
        select distinct x.village, x.name from jsonb_to_recordset(${wanted}::jsonb) as x(village text, name text)
      )
      select distinct w.village, w.name, ac.account_id as "accountId", ac.contact_id as "contactId"
        from customer_sites s
        join wanted w on regexp_replace(lower(s.village), '[^a-z0-9]+', '', 'g') = w.village
        join accounts a on a.id = s.account_id and a.archived_at is null
        join account_contacts ac on ac.account_id = s.account_id
        join contacts c on c.id = ac.contact_id and c.archived_at is null
       where s.archived_at is null
         and regexp_replace(lower(c.name), '[^a-z0-9]+', '', 'g') = w.name
       order by w.village, w.name, "accountId", "contactId"`)) as unknown as {
      village: string;
      name: string;
      accountId: string;
      contactId: string;
    }[];
    for (const row of rows) {
      const key = pairKey(row);
      const list = found.get(key) ?? [];
      if (list.length < MAX_SUGGESTIONS) {
        list.push({ accountId: row.accountId, contactId: row.contactId, reason: 'name_village' });
      }
      found.set(key, list);
    }
  }
  return found;
}

/** Phone matches first, then name and village matches of another customer, five at most. */
function suggestions(
  byPhone: ImportDedupeDto['existing'],
  byNameVillage: ImportDedupeDto['existing'],
): ImportDedupeDto['existing'] {
  const merged = [...byPhone];
  for (const match of byNameVillage) {
    const seen = merged.some(
      (m) => m.accountId === match.accountId && m.contactId === match.contactId,
    );
    if (!seen && merged.length < MAX_SUGGESTIONS) merged.push(match);
  }
  return merged;
}

/**
 * `imports.job.preview` (IMP-01): every row through the `crm.lead.create` input and the
 * entity's pipelines and lead sources, with dedupe suggestions by phone and by name and village,
 * each labelled with its reason. A repeat of an earlier
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
    const pairs = new Map<number, { name: string; village: string }>();
    for (const { rowNo, check } of checked) {
      const pair = check.input === null ? null : nameVillageKey(check.input);
      if (pair !== null) pairs.set(rowNo, pair);
    }
    const namesakes = await existingByNameAndVillage(ctx.tx, [...pairs.values()]);

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
      const pair = pairs.get(rowNo);
      const matches = suggestions(
        existing.get(check.phone) ?? [],
        pair === undefined ? [] : (namesakes.get(pairKey(pair)) ?? []),
      );
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
