import { newId, STAFF_ROLE_KEYS, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getImportReconciliation } from '../../src/queries/imports/import-queries';

// The reconciliation of an import job (IMP-01, IMP-02): every row counted once by what became of
// it, the refusals by their first reason, all from what the import stored; read by whoever may
// import in the job's company, and by nobody else (RLS on the job and its rows).

afterAll(closeDb);

let gm: Principal;
let jobId: string;

beforeAll(async () => {
  gm = await createTestPrincipal('general_manager', [1]);
  const fileId = await createReadyImportFile(1, gm.id, { name: `reconcile-${newId()}.csv` });
  jobId = newId();
  const row = (
    rowNo: number,
    state: string,
    errors: { field: string; code: string }[] = [],
    created: { type: string; id: string } | null = null,
  ) => ({
    job_id: jobId,
    entity_id: 1,
    row_no: rowNo,
    raw_json: { Name: `row ${String(rowNo)}` },
    errors_json: errors,
    state,
    created_type: created?.type ?? null,
    created_id: created?.id ?? null,
    created_by: gm.id,
  });
  const rows = [
    row(1, 'committed', [], { type: 'account', id: newId() }),
    row(2, 'committed', [], { type: 'account_link', id: newId() }),
    // A row that made nothing new: added to what was there.
    row(3, 'committed'),
    row(4, 'skipped'),
    row(5, 'invalid', [
      { field: 'phone', code: 'phone_invalid' },
      { field: 'name', code: 'required' },
    ]),
    row(6, 'invalid', [{ field: 'name', code: 'required' }]),
    row(7, 'invalid', [{ field: 'phone', code: 'customer_held_by_colleague' }]),
    // The row the commit stopped at keeps its state and carries the reason.
    row(8, 'valid', [{ field: 'row', code: 'commit_failed' }]),
    row(9, 'valid'),
    row(10, 'pending'),
    row(11, 'rolled_back'),
  ];
  await asMigrator(async (m) => {
    await m`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, state,
                                     total_rows, valid_rows, invalid_rows, skipped_rows,
                                     committed_rows, failed_batch, batch_count, created_by)
            values (${jobId}, 1, 'accounts', ${fileId}, 'csv', '["Name"]', 'failed',
                    11, 6, 3, 1, 3, 2, 2, ${gm.id})`;
    for (const r of rows) {
      await m`insert into import_rows (job_id, entity_id, row_no, raw_json, errors_json, state,
                                       created_type, created_id, created_by)
              values (${r.job_id}, 1, ${r.row_no}, ${m.json(r.raw_json)}, ${m.json(r.errors_json)},
                      ${r.state}, ${r.created_type}, ${r.created_id}, ${r.created_by})`;
    }
  });
});

const EXPECTED = {
  kind: 'accounts',
  state: 'failed',
  fileRows: 11,
  rowsIn: 11,
  created: 1,
  attached: 2,
  skipped: 1,
  refused: 4,
  waiting: 2,
  undone: 1,
  refusedByReason: [
    { reason: 'required', rows: 1 },
    { reason: 'phone_invalid', rows: 1 },
    { reason: 'commit_failed', rows: 1 },
    { reason: 'customer_held_by_colleague', rows: 1 },
  ],
};

describe('getImportReconciliation', () => {
  it('counts every row once, and the counts add up to the rows of the file', async () => {
    const seen = await asPrincipal(gm, (ctx) =>
      getImportReconciliation(ctx, { entityId: 1, jobId }),
    );
    expect(seen).toEqual({ jobId, entityId: 1, ...EXPECTED });
  });

  it('answers every role that may import in the company, and refuses every other role and company', async () => {
    for (const role of STAFF_ROLE_KEYS) {
      for (const entityIds of [[1], [2]]) {
        const principal = principalFor(role, entityIds);
        const mayImport = principal.permissions.some(
          (g) => g.key === 'imports.write' && (g.scope === 'entity' || g.scope === 'all'),
        );
        const outcome = await asPrincipal(principal, (ctx) =>
          getImportReconciliation(ctx, { entityId: 1, jobId }),
        ).then(
          (r) => r.rowsIn,
          (e: unknown) => (e as { code?: string }).code,
        );
        expect({ role, entityIds, outcome }).toEqual({
          role,
          entityIds,
          // In company 2 the job is outside the request; in company 1 only an importer reads it.
          outcome: mayImport && entityIds[0] === 1 ? EXPECTED.rowsIn : 'forbidden',
        });
      }
    }
  });

  it('finds no job of another company even when asked for it under its own', async () => {
    const otherGm = principalFor('general_manager', [2]);
    await expect(
      asPrincipal(otherGm, (ctx) => getImportReconciliation(ctx, { entityId: 2, jobId })),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
