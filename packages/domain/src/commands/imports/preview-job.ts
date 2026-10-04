import {
  DomainError,
  ImportJobDto,
  PreviewImportJobInput,
  type AccountImportMapping,
  type AccountImportRowInput,
  type ImportDedupeDto,
  type ImportRowErrorDto,
  type LeadImportMapping,
  type PinCodeImportMapping,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import type { CommandContext } from '../../command/context';
import { checkAccountRow, companyNames, foldAccountRows } from '../../imports/accounts';
import { assertImportJobMove } from '../../imports/job-state';
import { checkLeadRow, firstRowByPhone, matchKey, type LeadRowLookups } from '../../imports/leads';
import { checkPinCodeRow } from '../../imports/pin-codes';
import {
  assertEntityInScope,
  assertGroupImport,
  implementedKind,
  jobState,
  loadJob,
  parseMappingFor,
  toImportJobDto,
  updateJob,
} from './shared';

/** Rows updated, and phones or names looked up, per statement. */
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

interface FileRow {
  rowNo: number;
  raw: Record<string, string>;
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
        list.push({ accountId: row.accountId, contactId: row.contactId, matchedBy: 'phone' });
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
 * for the many farmers a file lists without the number the office already has. The database
 * keeps each side's key as a stored column (`customer_sites.village_key`, `contacts.name_key`),
 * so each equality is an index condition under the policies (docs/DATABASE.md §4.2) and the
 * search stays fast however many customers the group has (docs/spikes/import-scale.md).
 */
export async function existingByNameAndVillage(
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
        from wanted w
        join customer_sites s on s.village_key = w.village and s.archived_at is null
        join accounts a on a.id = s.account_id and a.archived_at is null
        join account_contacts ac on ac.account_id = s.account_id
        join contacts c on c.id = ac.contact_id and c.archived_at is null and c.name_key = w.name
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
        list.push({
          accountId: row.accountId,
          contactId: row.contactId,
          matchedBy: 'name_village',
        });
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

interface Candidate {
  rowNo: number;
  phone: string;
  name: string;
  village: string | undefined;
}

/** The existing customers a row may already be: all of them, and those with its phone. */
interface Suggestions {
  (rowNo: number): ImportDedupeDto['existing'];
  byPhone(rowNo: number): ImportDedupeDto['existing'];
}

/** The existing customers each valid row may already be, by its phone and its name and village. */
async function customerSuggestions(
  tx: RequestTx,
  valid: readonly Candidate[],
): Promise<Suggestions> {
  const byPhone = await existingByPhone(
    tx,
    valid.map((v) => v.phone),
  );
  const pairs = new Map<number, { name: string; village: string }>();
  for (const v of valid) {
    const name = matchKey(v.name);
    const village = matchKey(v.village);
    if (name !== '' && village !== '') pairs.set(v.rowNo, { name, village });
  }
  const namesakes = await existingByNameAndVillage(tx, [...pairs.values()]);
  const phoneOf = new Map(valid.map((v) => [v.rowNo, v.phone]));
  const phoneMatches = (rowNo: number) => byPhone.get(phoneOf.get(rowNo) ?? '') ?? [];
  const all = (rowNo: number) => {
    const pair = pairs.get(rowNo);
    return suggestions(
      phoneMatches(rowNo),
      pair === undefined ? [] : (namesakes.get(pairKey(pair)) ?? []),
    );
  };
  return Object.assign(all, { byPhone: phoneMatches });
}

function invalid(rowNo: number, errors: ImportRowErrorDto[]): RowFinding {
  return {
    row_no: rowNo,
    state: 'invalid',
    normalised_json: null,
    errors_json: errors,
    dedupe_json: null,
  };
}

/**
 * Leads (design §8): every row through the `crm.lead.create` input and the entity's pipelines and
 * lead sources; a repeat of an earlier row's phone is skipped; an existing customer is suggested.
 */
async function previewLeads(
  ctx: CommandContext,
  rows: readonly FileRow[],
  mapping: LeadImportMapping,
  entityId: number,
): Promise<RowFinding[]> {
  const known = await lookups(ctx.tx, entityId);
  const checked = rows.map((row) => ({
    rowNo: row.rowNo,
    check: checkLeadRow(row.raw, mapping, entityId, known),
  }));
  const repeats = firstRowByPhone(checked.map((c) => ({ rowNo: c.rowNo, phone: c.check.phone })));
  const existing = await customerSuggestions(
    ctx.tx,
    checked.flatMap(({ rowNo, check }): Candidate[] =>
      check.state === 'valid'
        ? [
            {
              rowNo,
              phone: check.phone,
              name: check.input.contact?.name ?? '',
              village: check.input.site?.village,
            },
          ]
        : [],
    ),
  );
  return checked.map(({ rowNo, check }) => {
    if (check.state === 'invalid') return invalid(rowNo, check.errors);
    const inFileRowNo = repeats.get(rowNo) ?? null;
    const matches = existing(rowNo);
    return {
      row_no: rowNo,
      state: inFileRowNo === null ? 'valid' : 'skipped',
      normalised_json: check.input,
      errors_json: [],
      dedupe_json:
        inFileRowNo === null && matches.length === 0 ? null : { inFileRowNo, existing: matches },
    };
  });
}

/**
 * Customers (design §6.3): each row through `AccountImportRowInput`, its company named by code or
 * name among the request's companies; rows of one customer fold into the first, which takes on
 * every company they name and every different site they give; an existing customer is suggested,
 * as for leads, and one the importer can see with the row's mobile number is the customer the row
 * is added to (`existingAccountId`), instead of a new one.
 */
async function previewAccounts(
  ctx: CommandContext,
  rows: readonly FileRow[],
  mapping: AccountImportMapping,
  entityId: number,
): Promise<RowFinding[]> {
  const e = schema.entities;
  const companies = companyNames(
    await ctx.tx
      .select({ id: e.id, code: e.code, brandName: e.brandName, legalName: e.legalName })
      .from(e)
      .where(and(inArray(e.id, [...ctx.entityIds]), isNull(e.archivedAt))),
  );
  const checked = rows.map((row) => ({
    rowNo: row.rowNo,
    check: checkAccountRow(row.raw, mapping, entityId, companies),
  }));
  const folded = foldAccountRows(checked);
  const existing = await customerSuggestions(
    ctx.tx,
    checked.flatMap(({ rowNo, check }): Candidate[] =>
      check.state === 'valid' && !folded.repeats.has(rowNo)
        ? [
            {
              rowNo,
              phone: check.phone,
              name: check.input.contact.name,
              village: check.input.site?.village,
            },
          ]
        : [],
    ),
  );
  return checked.map(({ rowNo, check }) => {
    if (check.state === 'invalid') return invalid(rowNo, check.errors);
    const inFileRowNo = folded.repeats.get(rowNo) ?? null;
    if (inFileRowNo !== null) {
      const site = folded.sites.get(rowNo);
      return {
        row_no: rowNo,
        state: 'skipped',
        normalised_json: check.input,
        errors_json: [],
        dedupe_json: { inFileRowNo, existing: [], ...(site === undefined ? {} : { site }) },
      };
    }
    const matches = existing(rowNo);
    // The owner's rule (05-10-2026): a number a customer the importer can see already has links
    // the row to that customer, so no second record is made.
    const linkedTo = existing.byPhone(rowNo)[0]?.accountId;
    const moreSites = folded.moreSites.get(rowNo);
    const input: AccountImportRowInput = {
      ...check.input,
      entityIds: folded.companies.get(rowNo) ?? check.input.entityIds,
      ...(moreSites === undefined ? {} : { moreSites }),
      ...(linkedTo === undefined ? {} : { existingAccountId: linkedTo }),
    };
    return {
      row_no: rowNo,
      state: 'valid',
      normalised_json: input,
      errors_json: [],
      dedupe_json:
        matches.length === 0
          ? null
          : {
              inFileRowNo: null,
              existing: matches,
              ...(linkedTo === undefined ? {} : { linkedTo }),
            },
    };
  });
}

/** The PIN code master (CRM-02): each office checked; an office listed twice is skipped. */
function previewPinCodes(rows: readonly FileRow[], mapping: PinCodeImportMapping): RowFinding[] {
  const first = new Map<string, number>();
  return rows.map((row) => {
    const check = checkPinCodeRow(row.raw, mapping);
    if (check.state === 'invalid') return invalid(row.rowNo, check.errors);
    const earlier = first.get(check.key);
    if (earlier === undefined) first.set(check.key, row.rowNo);
    return {
      row_no: row.rowNo,
      state: earlier === undefined ? 'valid' : 'skipped',
      normalised_json: check.input,
      errors_json: [],
      dedupe_json: earlier === undefined ? null : { inFileRowNo: earlier, existing: [] },
    };
  });
}

/** The companies the ready rows of a job name, the job's own first, each once. */
function jobCompanies(entityId: number, findings: readonly RowFinding[]): number[] {
  const ids = [entityId];
  for (const f of findings) {
    if (f.state !== 'valid') continue;
    const named = (f.normalised_json as { entityIds?: number[] }).entityIds;
    for (const id of named ?? []) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * `imports.job.preview` (IMP-01): every row checked through the input its commit uses, with the
 * findings of each kind: leads and customers with dedupe suggestions by phone and by name and
 * village, each labelled with its reason, and a repeat of an earlier row skipped (for customers,
 * folded into it); offices of the PIN code master checked against the directory's form. A match
 * with an existing customer is only suggested, and the row still imports as a new one, except a
 * customers row with the mobile number of a customer the caller can see, which is added to that
 * customer. The job records the companies its ready rows name, its own first: adding them and
 * undoing them need a request that acts for every one.
 */
export const previewImportJob = defineCommand({
  name: 'imports.job.preview',
  permission: 'imports.write',
  minScope: 'entity',
  input: PreviewImportJobInput,
  output: ImportJobDto,
  auditFields: [
    'state',
    'validRows',
    'invalidRows',
    'skippedRows',
    'suggested',
    'linked',
    'companies',
  ],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    const before = jobState(loaded.job);
    assertImportJobMove(before, 'previewed');
    if (loaded.job.mappingJson === null) {
      throw new DomainError('conflict', 'the job has no mapping', { reason: 'import_job_state' });
    }
    const kind = implementedKind(loaded.job);
    if (kind === 'pin_codes') await assertGroupImport(ctx);

    const r = schema.importRows;
    const rows = (await ctx.tx
      .select({ rowNo: r.rowNo, raw: r.rawJson })
      .from(r)
      .where(eq(r.jobId, loaded.job.id))
      .orderBy(asc(r.rowNo))) as FileRow[];

    const mapping = loaded.job.mappingJson;
    const findings =
      kind === 'leads'
        ? await previewLeads(ctx, rows, parseMappingFor('leads', mapping), input.entityId)
        : kind === 'accounts'
          ? await previewAccounts(ctx, rows, parseMappingFor('accounts', mapping), input.entityId)
          : previewPinCodes(rows, parseMappingFor('pin_codes', mapping));

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
    const entityIds = kind === 'pin_codes' ? null : jobCompanies(input.entityId, findings);
    const previewed = await updateJob(ctx.tx, loaded, {
      state: 'previewed',
      ...counts,
      entityIds,
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
        linked: findings.filter((f) => f.dedupe_json?.linkedTo !== undefined).length,
        companies: entityIds?.length ?? null,
      },
    });

    return toImportJobDto(previewed);
  },
});
