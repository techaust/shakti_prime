import { newId, type ImportJobDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
  testPhone,
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
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listImportRows } from '../../src/queries/imports/import-queries';

/**
 * R3's installed base import (docs/03-roadmap-appendix/phase3.md §7.5) on real Postgres: serials
 * sold before go-live enter as `with_customer` with their customer, site and warranty, refused row
 * by row with their reason, with no stock movement; the rollback takes back each serial no claim
 * has used since. Company 2 is this file's.
 */

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

const ENTITY = 2;
const tag = newId().slice(-8).toUpperCase();
let exec: Principal;
const pump = newId();
const motor = newId();
const cable = newId();
const farm = newId();
const twoSites = newId();
const farmSite = newId();
const phone = testPhone();
const otherPhone = testPhone();
const strangerPhone = testPhone();

function run<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
  input: unknown,
  who: Principal = exec,
): Promise<z.output<O>> {
  return asPrincipal({ ...who, entityIds: [ENTITY] }, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const MAPPING = {
  columns: {
    sku: 'SKU',
    serialNo: 'Serial',
    phone: 'Mobile',
    village: 'Village',
    deliveredOn: 'Delivered',
    warrantyUntil: 'Warranty until',
    company: 'Company',
  },
};

async function uploaded(csv: string, who: Principal = exec): Promise<ImportJobDto> {
  const parsed = await parseImportFile(new TextEncoder().encode(csv));
  const fileId = await createReadyImportFile(ENTITY, who.id, { name: 'installed.csv' });
  return run(
    createImportJob,
    {
      entityId: ENTITY,
      kind: 'installed_base',
      fileId,
      format: parsed.format,
      columns: parsed.columns,
      rows: parsed.rows,
    },
    who,
  );
}

async function previewed(csv: string): Promise<ImportJobDto> {
  const job = await uploaded(csv);
  const header = csv.split('\n')[0]?.split(',') ?? [];
  // The mapping, keeping only the columns the file has.
  const mapping = {
    columns: Object.fromEntries(
      Object.entries(MAPPING.columns).filter(([, column]) => header.includes(column)),
    ),
  };
  await run(mapImportJob, { entityId: ENTITY, jobId: job.id, mapping });
  return run(previewImportJob, { entityId: ENTITY, jobId: job.id });
}

async function committed(job: ImportJobDto): Promise<ImportJobDto> {
  let current = await run(commitImportJob, { entityId: ENTITY, jobId: job.id });
  while (current.state === 'committing') {
    current = await run(commitImportBatch, { entityId: ENTITY, jobId: job.id });
  }
  return current;
}

async function serial(itemId: string, serialNo: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        id: string;
        state: string;
        account: string;
        site: string | null;
        bin: string | null;
        delivered: string;
        until: string;
        moves: number;
      }[]
    >`
      select s.id, s.state, s.account_id as account, s.site_id as site, s.bin_id as bin,
             (s.delivered_at at time zone 'Asia/Kolkata')::date::text as delivered,
             s.warranty_until::text as until,
             (select count(*)::int from stock_movements m where m.serial_id = s.id) as moves
        from serials s where s.item_id = ${itemId} and lower(s.serial_no) = lower(${serialNo})`,
  );
  return row;
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active, warranty_months) values
        (${pump}, ${`IP-${tag}`}, ${`Installed pump ${tag}`}, 'pump', '8413', 'nos', true, true, 24),
        (${motor}, ${`IM-${tag}`}, ${`Installed motor ${tag}`}, 'motor', '8501', 'nos', true, true, null)`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active)
        values (${cable}, ${`IC-${tag}`}, ${`Installed cable ${tag}`}, 'cable', '8544', 'metre', false, true)`;
      for (const [account, mobile] of [
        [farm, phone],
        [twoSites, otherPhone],
      ] as const) {
        const contact = newId();
        await tx`insert into accounts (id, type, name, created_by)
          values (${account}, 'farm', ${`Installed farm ${tag}`}, ${exec.id})`;
        await tx`insert into account_entities (id, account_id, entity_id, created_by)
          values (${newId()}, ${account}, ${ENTITY}, ${exec.id})`;
        await tx`insert into contacts (id, name, created_by) values (${contact}, 'Installed owner', ${exec.id})`;
        await tx`insert into contact_phones (id, contact_id, e164, created_by)
          values (${newId()}, ${contact}, ${`+91${mobile}`}, ${exec.id})`;
        await tx`insert into account_contacts (account_id, contact_id, role, created_by)
          values (${account}, ${contact}, 'owner', ${exec.id})`;
      }
      await tx`insert into customer_sites (id, account_id, type, village, created_by) values
        (${farmSite}, ${farm}, 'borewell', 'Chomu', ${exec.id}),
        (${newId()}, ${twoSites}, 'borewell', 'Bassi', ${exec.id}),
        (${newId()}, ${twoSites}, 'borewell', 'Sanganer', ${exec.id})`;
      await tx`insert into serials (id, entity_id, item_id, serial_no, state, bin_id, account_id, created_by)
        values (${newId()}, 1, ${pump}, ${`IB-${tag}-OLD`}, 'with_customer', null, null, ${exec.id})`;
    }),
  );
});

describe('the installed base import', () => {
  it('is refused to anyone without inventory.warranty.write as well as imports.write', async () => {
    const gm = await createTestPrincipal('general_manager', [ENTITY]);
    await expect(
      uploaded(`SKU,Serial,Mobile,Delivered\nIP-${tag},IB-${tag}-1,${phone},10-03-2025`, gm),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const manager = await createTestPrincipal('inventory_manager', [ENTITY]);
    await expect(
      uploaded(`SKU,Serial,Mobile,Delivered\nIP-${tag},IB-${tag}-1,${phone},10-03-2025`, manager),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('checks each row, adds the valid serials to their customers with their warranty, and moves no stock', async () => {
    const [company] = await asMigrator(
      (m) => m<{ code: string }[]>`select code from entities where id = ${ENTITY}`,
    );
    const csv = [
      'SKU,Serial,Mobile,Village,Delivered,Warranty until,Company',
      `IP-${tag},IB-${tag}-1,${phone},,10-03-2025,,`,
      `ip-${tag},IB-${tag}-2,+91 ${otherPhone},Sanganer,2025-11-30,,${company?.code ?? ''}`,
      `IM-${tag},IB-${tag}-3,0${phone},chomu,01/04/2024,31-03-2026,`,
      // Refused: an unknown code, an item without serials, a serial another company holds, a
      // serial twice in the file, an unknown mobile, a village none of the sites is in, a
      // delivery ahead of today, no warranty months and no end, another company.
      `IX-${tag},IB-${tag}-4,${phone},,10-03-2025,,`,
      `IC-${tag},IB-${tag}-5,${phone},,10-03-2025,,`,
      `IP-${tag},ib-${tag}-old,${phone},,10-03-2025,,`,
      `IP-${tag},IB-${tag}-1,${phone},,10-03-2025,,`,
      `IP-${tag},IB-${tag}-6,${strangerPhone},,10-03-2025,,`,
      `IP-${tag},IB-${tag}-7,${phone},Dausa,10-03-2025,,`,
      `IP-${tag},IB-${tag}-8,${phone},,01-01-2099,,`,
      `IM-${tag},IB-${tag}-9,${phone},,10-03-2025,,`,
      `IP-${tag},IB-${tag}-10,${phone},,10-03-2025,,ANOTHER`,
    ].join('\n');
    const job = await previewed(csv);
    // The serial company 1 holds is out of this request's sight until the row is added.
    expect(job).toMatchObject({ state: 'previewed', validRows: 4, invalidRows: 8 });
    const refusals = async () => {
      const page = await asPrincipal({ ...exec, entityIds: [ENTITY] }, (ctx) =>
        listImportRows(ctx, { entityId: ENTITY, jobId: job.id, limit: 50 }),
      );
      return page.rows
        .filter((r) => r.state === 'invalid')
        .map((r) => [r.rowNo, r.errors.map((e) => e.code).join('+')]);
    };
    const found = [
      [4, 'sku_unknown'],
      [5, 'serial_not_tracked'],
      [7, 'serial_taken'],
      [8, 'customer_unknown'],
      [9, 'site_unknown'],
      [10, 'date_invalid'],
      [11, 'warranty_unknown'],
      [12, 'company_mismatch'],
    ];
    expect(await refusals()).toEqual(found);

    const done = await committed(job);
    expect(done).toMatchObject({ state: 'committed', committedRows: 3 });
    expect(await refusals()).toEqual(
      [...found, [6, 'serial_taken']].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
    expect(await serial(pump, `IB-${tag}-1`)).toMatchObject({
      state: 'with_customer',
      account: farm,
      site: farmSite,
      bin: null,
      delivered: '2025-03-10',
      until: '2027-03-09',
      moves: 0,
    });
    // A customer of several sites takes the site its village names.
    expect(await serial(pump, `IB-${tag}-2`)).toMatchObject({
      account: twoSites,
      until: '2027-11-29',
      moves: 0,
    });
    expect((await serial(pump, `IB-${tag}-2`))?.site).not.toBeNull();
    // The end given in the file wins over the item's months.
    expect(await serial(motor, `IB-${tag}-3`)).toMatchObject({
      site: farmSite,
      delivered: '2024-04-01',
      until: '2026-03-31',
    });
  });

  it('rolls back the serials no claim has used since, and keeps the others', async () => {
    const job = await committed(
      await previewed(
        [
          'SKU,Serial,Mobile,Delivered',
          `IP-${tag},IR-${tag}-1,${phone},10-03-2025`,
          `IP-${tag},IR-${tag}-2,${phone},10-03-2025`,
        ].join('\n'),
      ),
    );
    expect(job.state).toBe('committed');
    const claimed = await serial(pump, `IR-${tag}-2`);
    await asMigrator(
      (
        m,
      ) => m`insert into warranty_claims (id, entity_id, claim_no, account_id, item_id, serial_id, reported_fault, state, created_by)
        values (${newId()}, ${ENTITY}, ${`IR${tag}/1`}, ${farm}, ${pump}, ${claimed?.id ?? ''}, 'No water', 'serial_identified', ${exec.id})`,
    );
    const undone = await run(rollbackImportJob, { entityId: ENTITY, jobId: job.id });
    expect(undone.state).toBe('rolled_back');
    expect(await serial(pump, `IR-${tag}-1`)).toBeUndefined();
    expect(await serial(pump, `IR-${tag}-2`)).toMatchObject({ state: 'with_customer' });
  });
});
