// U1: the vendors import kind (docs/03-roadmap-appendix/phase3.md §6.3) on real Postgres: a vendor
// list's rows become vendors of the group, a GSTIN already in the master updates that vendor and
// adds the row's person, a GSTIN listed twice is skipped, an archived vendor's GSTIN is refused,
// and a rollback archives only the vendors the job added.
import { newId, type ImportJobDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { rollbackImportJob } from '../../src/commands/imports/rollback-job';
import { archiveVendor, createVendor } from '../../src/commands/procurement/vendors';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listImportRows } from '../../src/queries/imports/import-queries';

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

function run<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<z.output<O>> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

/** A GSTIN no earlier run used: state 08, the PAN's letters from the run, its digits counted. */
const tag = newId()
  .slice(-5)
  .toUpperCase()
  .replace(/[^A-Z]/g, 'K')
  .padEnd(5, 'K');
let n = 0;
const fresh = () => {
  n += 1;
  const digits = String(1000 + Math.floor(Math.random() * 8000) + n).slice(-4);
  return `08${tag}${digits}F1Z5`;
};

const MAPPING = {
  columns: {
    vendorName: 'Supplier',
    gstin: 'GSTIN',
    city: 'City',
    leadTimeDays: 'Lead days',
    personName: 'Person',
    personPhone: 'Mobile',
  },
};

async function startedJob(principal: Principal, csv: string): Promise<ImportJobDto> {
  const parsed = await parseImportFile(new TextEncoder().encode(csv));
  const fileId = await createReadyImportFile(1, principal.id, { name: 'vendors.csv' });
  return run(principal, createImportJob, {
    entityId: 1,
    kind: 'vendors',
    fileId,
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  });
}

let executive: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
});

describe('the vendors import kind', () => {
  it('is refused to the General Manager, who imports but writes no purchase order', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(startedJob(gm, 'Supplier\nRefused Traders\n')).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('adds new vendors, updates one by its GSTIN, skips a repeat and refuses an archived vendor', async () => {
    const known = fresh();
    const archived = fresh();
    const added = fresh();
    const kept = await run(executive, createVendor, {
      name: `Import known ${tag}`,
      gstin: known,
      leadTimeDays: 3,
    });
    const gone = await run(executive, createVendor, {
      name: `Import gone ${tag}`,
      gstin: archived,
    });
    await run(executive, archiveVendor, { vendorId: gone.id });

    const csv = [
      'Supplier,GSTIN,City,Lead days,Person,Mobile',
      `Import new ${tag},${added},Jaipur,7,Anil Verma,9829011111`,
      `Import known renamed ${tag},${known},,12,Sunita Rao,9829022222`,
      `Import repeat ${tag},${added},Kota,5,,`,
      `Import gone again ${tag},${archived},,,,`,
      `Import bad ${tag},08ABC,,,,`,
      `,,Udaipur,,,`,
      `Import no gstin ${tag},,Ajmer,abc,,`,
    ].join('\n');
    const job = await startedJob(executive, csv);
    await run(executive, mapImportJob, { entityId: 1, jobId: job.id, mapping: MAPPING });
    const previewed = await run(executive, previewImportJob, { entityId: 1, jobId: job.id });
    expect(previewed).toMatchObject({ state: 'previewed', validRows: 2, skippedRows: 1 });
    const rows = await asPrincipal(executive, (ctx) =>
      listImportRows(ctx, { entityId: 1, jobId: job.id, limit: 50 }),
    );
    const byRow = new Map(rows.rows.map((r) => [r.rowNo, r]));
    expect(byRow.get(3)?.state).toBe('skipped');
    expect(byRow.get(4)?.errors).toEqual([{ field: 'gstin', code: 'vendor_archived' }]);
    expect(byRow.get(5)?.errors).toEqual([{ field: 'gstin', code: 'invalid' }]);
    expect(byRow.get(6)?.errors).toEqual([{ field: 'vendorName', code: 'required' }]);
    expect(byRow.get(7)?.errors).toEqual([{ field: 'leadTimeDays', code: 'invalid' }]);

    let current = await run(executive, commitImportJob, { entityId: 1, jobId: job.id });
    while (current.state === 'committing') {
      current = await run(executive, commitImportBatch, { entityId: 1, jobId: job.id });
    }
    expect(current).toMatchObject({ state: 'committed', committedRows: 2 });

    const vendors = await asMigrator(
      (m) => m<
        {
          id: string;
          name: string;
          gstin: string;
          lead: number;
          city: string | null;
          people: string[];
        }[]
      >`
        select v.id, v.name, v.gstin, v.lead_time_days as lead, v.address_json ->> 'city' as city,
               coalesce(array_agg(c.name order by c.position) filter (where c.id is not null), '{}') as people
          from vendors v left join vendor_contacts c on c.vendor_id = v.id
         where v.gstin in (${added}, ${known})
         group by v.id order by v.gstin`,
    );
    const byGstin = new Map(vendors.map((v) => [v.gstin, v]));
    expect(byGstin.get(added)).toMatchObject({
      name: `Import new ${tag}`,
      lead: 7,
      city: 'Jaipur',
      people: ['Anil Verma'],
    });
    expect(byGstin.get(known)).toMatchObject({
      id: kept.id,
      name: `Import known renamed ${tag}`,
      lead: 12,
      people: ['Sunita Rao'],
    });

    const rolled = await run(executive, rollbackImportJob, { entityId: 1, jobId: job.id });
    expect(rolled.state).toBe('rolled_back');
    const after = await asMigrator(
      (m) => m<{ gstin: string; active: boolean }[]>`
        select gstin, is_active as active from vendors where gstin in (${added}, ${known}) order by gstin`,
    );
    expect(Object.fromEntries(after.map((v) => [v.gstin, v.active]))).toEqual({
      [added]: false,
      [known]: true,
    });
  });
});
