import {
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type ImportJobDto,
  type ImplementedImportKind,
  type PermissionGrant,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
  createTestTeam,
  grantsForRole,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { sweepUploads } from '../../src/commands/files/sweep-uploads';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { failImportJob } from '../../src/commands/imports/fail-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { rollbackImportJob } from '../../src/commands/imports/rollback-job';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { lookupPin } from '../../src/queries/crm/pin-lookup';
import { staleUploadCompanies } from '../../src/queries/files/file-queries';
import { listImportRows } from '../../src/queries/imports/import-queries';

// The import kinds of the imports upgrade (docs/design/phase1.md §6.3) on real Postgres: customers
// with a relationship per row's company and repeats folded into one, the PIN code master, the
// fail command the worker runs after its last retry, and the sweep of abandoned uploads. PINs
// start 9999 and name fixture offices, outside the India Post directory.

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

function run<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
  scope?: readonly number[],
): Promise<z.output<O>> {
  const acting = scope === undefined ? principal : { ...principal, entityIds: [...scope] };
  return asPrincipal(acting, (context) => runCommand(command, { context, audit, outbox }, input));
}

/** A mobile number no earlier run used. */
function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

/** A fixture PIN with no office left by an earlier run. 999901 is the CRM fixture's. */
async function freshPin(): Promise<string> {
  const code = `9999${String(10 + Math.floor(Math.random() * 90))}`;
  await asMigrator((m) => m`delete from pin_codes where pin = ${code}`);
  return code;
}

/** A started job of a CSV file, as the screen's second step starts it. */
async function startedJob(
  principal: Principal,
  kind: ImplementedImportKind,
  csv: string,
  entityId = 1,
): Promise<ImportJobDto> {
  const parsed = await parseImportFile(new TextEncoder().encode(csv));
  const fileId = await createReadyImportFile(entityId, principal.id, { name: `${kind}.csv` });
  return run(principal, createImportJob, {
    entityId,
    kind,
    fileId,
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  });
}

async function rowsOf(principal: Principal, jobId: string, entityId = 1) {
  const page = await asPrincipal(principal, (ctx) =>
    listImportRows(ctx, { entityId, jobId, limit: 200 }),
  );
  return page.rows;
}

/** Commits a previewed job batch by batch until it stops. */
async function committed(principal: Principal, job: ImportJobDto): Promise<ImportJobDto> {
  let current = await run(principal, commitImportJob, { entityId: job.entityId, jobId: job.id });
  while (current.state === 'committing') {
    current = await run(principal, commitImportBatch, { entityId: job.entityId, jobId: job.id });
  }
  return current;
}

const ACCOUNT_MAPPING = {
  columns: { contactName: 'Name', phone: 'Mobile', village: 'Village', company: 'Company' },
  defaults: { accountType: 'farm', siteType: 'borewell' },
};
/** A customers file with no Company column: every row is the job's own company's. */
const OWN_COMPANY_MAPPING = {
  columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
  defaults: { accountType: 'farm', siteType: 'borewell' },
};
const NAME_PHONE_MAPPING = { columns: { contactName: 'Name', phone: 'Mobile' }, defaults: {} };
const PIN_MAPPING = {
  columns: {
    pin: 'Pincode',
    officeName: 'OfficeName',
    taluk: 'Taluk',
    district: 'District',
    state: 'StateName',
  },
};

let executive: Principal;
let gm1: Principal;
let gm2: Principal;
let caller: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
  gm1 = await createTestPrincipal('general_manager', [1]);
  gm2 = await createTestPrincipal('general_manager', [2]);
  caller = await createTestPrincipal('tele_caller_cc', [1]);
});

/** The companies a customer deals with, read past the policies. */
async function companiesOf(accountId: string): Promise<number[]> {
  const rows = await asMigrator(
    (m) => m<{ entity_id: number }[]>`
      select entity_id from account_entities where account_id = ${accountId} order by entity_id`,
  );
  return rows.map((r) => r.entity_id);
}

describe('imports of customers (accounts)', () => {
  it('is denied without imports.write and refused for a company outside the request', async () => {
    const csv = `Name,Mobile\nRefused,${phone()}\n`;
    await expect(startedJob(caller, 'accounts', csv)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(startedJob(gm2, 'accounts', csv, 1)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('makes a customer per row with a relationship per company, folding repeats into one', async () => {
    const [first, second, third] = [phone(), phone(), phone()];
    const job = await startedJob(
      executive,
      'accounts',
      [
        'Name,Mobile,Village,Company',
        `Folded Farmer,${first},Sikar,`,
        `Second Farmer,${second},Churu,SMP`,
        `Folded Farmer again,${first},Sikar,Shakti Motor Pumps`,
        `Unknown Company,${third},Nagaur,Nowhere Traders`,
        `No Number,,Nagaur,SS`,
      ].join('\n') + '\n',
    );
    await run(executive, mapImportJob, { entityId: 1, jobId: job.id, mapping: ACCOUNT_MAPPING });
    const previewed = await run(executive, previewImportJob, { entityId: 1, jobId: job.id });
    expect(previewed).toMatchObject({ validRows: 2, invalidRows: 2, skippedRows: 1 });
    const rows = await rowsOf(executive, job.id);
    expect(rows.map((r) => [r.rowNo, r.state])).toEqual([
      [1, 'valid'],
      [2, 'valid'],
      [3, 'skipped'],
      [4, 'invalid'],
      [5, 'invalid'],
    ]);
    expect(rows[2]?.dedupe).toEqual({ inFileRowNo: 1, existing: [] });
    expect(rows[3]?.errors).toEqual([{ field: 'company', code: 'company_unknown' }]);
    expect(rows[4]?.errors).toEqual([{ field: 'phone', code: 'required' }]);

    const done = await committed(executive, previewed);
    expect(done).toMatchObject({ state: 'committed', committedRows: 2 });
    const made = await rowsOf(executive, job.id);
    const folded = made[0];
    expect(folded).toMatchObject({ state: 'committed', createdType: 'account' });
    expect(await companiesOf(folded?.createdId ?? '')).toEqual([1, 2]);
    expect(await companiesOf(made[1]?.createdId ?? '')).toEqual([2]);
    // The second company's General Manager sees the customer the file named for them.
    const seen = await asPrincipal(gm2, async ({ tx }) =>
      (
        (await tx.execute(
          sql`select id from accounts where id = ${made[1]?.createdId ?? ''}`,
        )) as unknown as { id: string }[]
      ).map((r) => r.id),
    );
    expect(seen).toEqual([made[1]?.createdId]);
  });

  it('refuses a company the request does not act for', async () => {
    const job = await startedJob(
      gm1,
      'accounts',
      `Name,Mobile,Village,Company\nElsewhere,${phone()},Sikar,SMP\n`,
    );
    await run(gm1, mapImportJob, { entityId: 1, jobId: job.id, mapping: ACCOUNT_MAPPING });
    await run(gm1, previewImportJob, { entityId: 1, jobId: job.id });
    expect((await rowsOf(gm1, job.id))[0]?.errors).toEqual([
      { field: 'company', code: 'company_unknown' },
    ]);
  });

  it('refuses a mapping without the name and phone columns', async () => {
    const job = await startedJob(gm1, 'accounts', `Name,Mobile\nMapless,${phone()}\n`);
    await expect(
      run(gm1, mapImportJob, {
        entityId: 1,
        jobId: job.id,
        mapping: { columns: { contactName: 'Name' }, defaults: {} },
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'import_mapping_incomplete' },
    });
  });

  it('marks a number a colleague’s customer has, and goes on with the rest', async () => {
    const teamId = await createTestTeam(1, 'import kinds team');
    const owner = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const held = phone();
    await run(owner, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Held customer', phone: held },
      account: { type: 'farm' },
    });
    const otherTeam = await createTestTeam(1, 'import kinds other team');
    const permissions: PermissionGrant[] = grantsForRole('general_manager').map((g) =>
      g.key.startsWith('crm.lead.') || g.key.startsWith('crm.account.')
        ? { key: g.key, scope: 'own' }
        : g,
    );
    const importer = await createTestPrincipal('general_manager', [1], {
      teamId: otherTeam,
      permissions,
    });
    const job = await startedJob(
      importer,
      'accounts',
      `Name,Mobile,Village\nFree One,${phone()},Sikar\nHeld One,${held},Sikar\n`,
    );
    await run(importer, mapImportJob, { entityId: 1, jobId: job.id, mapping: OWN_COMPANY_MAPPING });
    const previewed = await run(importer, previewImportJob, { entityId: 1, jobId: job.id });
    const done = await committed(importer, previewed);
    expect(done).toMatchObject({
      state: 'committed',
      committedRows: 1,
      validRows: 1,
      invalidRows: 1,
    });
    expect((await rowsOf(importer, job.id)).map((r) => [r.state, r.errors])).toEqual([
      ['committed', []],
      ['invalid', [{ field: 'phone', code: 'customer_held_by_colleague' }]],
    ]);
  });

  it('rolls back the customers it made, keeping one a lead now belongs to', async () => {
    const [kept, gone] = [phone(), phone()];
    const job = await startedJob(
      gm1,
      'accounts',
      `Name,Mobile,Village\nKept Customer,${kept},Sikar\nGone Customer,${gone},Sikar\n`,
    );
    await run(gm1, mapImportJob, { entityId: 1, jobId: job.id, mapping: OWN_COMPANY_MAPPING });
    const done = await committed(
      gm1,
      await run(gm1, previewImportJob, { entityId: 1, jobId: job.id }),
    );
    expect(done.state).toBe('committed');
    const made = await rowsOf(gm1, job.id);
    const keptId = made[0]?.createdId ?? '';
    await run(gm1, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      existingAccountId: keptId,
    });
    const rolled = await run(gm1, rollbackImportJob, { entityId: 1, jobId: job.id });
    expect(rolled.state).toBe('rolled_back');
    const archived = await asMigrator(
      (m) => m<{ id: string; archived: boolean }[]>`
        select id, archived_at is not null as archived from accounts
         where id = any(${[keptId, made[1]?.createdId ?? '']}::uuid[]) order by name`,
    );
    expect(archived).toEqual(
      expect.arrayContaining([
        { id: keptId, archived: false },
        { id: made[1]?.createdId, archived: true },
      ]),
    );
  });
});

describe('imports of the PIN code master (pin_codes)', () => {
  it('is only for an Executive acting for every company', async () => {
    const csv = `Pincode,OfficeName,District\n999998,fixture office,Fixture\n`;
    await expect(startedJob(gm1, 'pin_codes', csv)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'import_needs_all_companies' },
    });
    await expect(
      asPrincipal({ ...executive, entityIds: [1] }, async (context) => {
        const parsed = await parseImportFile(new TextEncoder().encode(csv));
        const fileId = await createReadyImportFile(1, executive.id);
        return runCommand(
          createImportJob,
          { context, audit, outbox },
          {
            entityId: 1,
            kind: 'pin_codes',
            fileId,
            format: parsed.format,
            columns: parsed.columns,
            rows: parsed.rows,
          },
        );
      }),
    ).rejects.toMatchObject({ details: { reason: 'import_needs_all_companies' } });
  });

  it('adds the offices of the directory, corrects them on a later file and undoes only what it added', async () => {
    const [one, two] = [await freshPin(), await freshPin()];
    const header = 'Pincode,OfficeName,Taluk,District,StateName';
    const first = await startedJob(
      executive,
      'pin_codes',
      [
        header,
        `${one},Fixture One H.O,Fixture Taluk,Fixture District,RAJASTHAN`,
        `${one},Fixture Two B.O,Fixture Taluk,Fixture District,Rajasthan`,
        `${one},fixture one h.o,Fixture Taluk,Fixture District,08`,
        `12345,Short PIN B.O,Fixture Taluk,Fixture District,RAJASTHAN`,
        `${two},Fixture Three S.O,,Fixture Elsewhere,Atlantis`,
      ].join('\n') + '\n',
    );
    await run(executive, mapImportJob, { entityId: 1, jobId: first.id, mapping: PIN_MAPPING });
    const previewed = await run(executive, previewImportJob, { entityId: 1, jobId: first.id });
    expect(previewed).toMatchObject({ validRows: 2, skippedRows: 1, invalidRows: 2 });
    const rows = await rowsOf(executive, first.id);
    expect(rows.map((r) => [r.state, r.errors])).toEqual([
      ['valid', []],
      ['valid', []],
      ['skipped', []],
      ['invalid', [{ field: 'pin', code: 'invalid' }]],
      ['invalid', [{ field: 'state', code: 'state_unknown' }]],
    ]);
    expect(await committed(executive, previewed)).toMatchObject({
      state: 'committed',
      committedRows: 2,
    });

    // What a form now learns of the PIN, and what a site with it is given.
    const known = await asPrincipal(principalFor('tele_caller_cc', [2]), (ctx) =>
      lookupPin(ctx, { pin: one }),
    );
    expect(known).toEqual({
      pin: one,
      known: true,
      tehsil: 'Fixture Taluk',
      district: 'Fixture District',
      stateCode: '08',
      localities: ['Fixture One', 'Fixture Two'],
    });
    expect(
      await asPrincipal(principalFor('tele_caller_cc', [2]), (ctx) => lookupPin(ctx, { pin: two })),
    ).toEqual({
      pin: two,
      known: false,
      tehsil: null,
      district: null,
      stateCode: null,
      localities: [],
    });

    // A later file corrects one office and adds another.
    const second = await startedJob(
      executive,
      'pin_codes',
      [
        header,
        `${one},Fixture One H.O,Fixture Taluk,Fixture District Corrected,RAJASTHAN`,
        `${two},Fixture Three S.O,Fixture Taluk,Fixture Elsewhere,RAJASTHAN`,
      ].join('\n') + '\n',
    );
    await run(executive, mapImportJob, { entityId: 1, jobId: second.id, mapping: PIN_MAPPING });
    await committed(
      executive,
      await run(executive, previewImportJob, { entityId: 1, jobId: second.id }),
    );
    expect((await rowsOf(executive, second.id)).map((r) => r.createdType)).toEqual([
      null,
      'pin_code',
    ]);
    await run(executive, rollbackImportJob, { entityId: 1, jobId: second.id });
    const offices = await asMigrator(
      (m) => m<{ pin: string; office_name: string; district: string }[]>`
        select pin, office_name, district from pin_codes where pin = any(${[one, two]})
         order by office_name`,
    );
    // The office the second file added is gone; the correction it made stays.
    expect(offices).toEqual([
      { pin: one, office_name: 'Fixture One H.O', district: 'Fixture District Corrected' },
      { pin: one, office_name: 'Fixture Two B.O', district: 'Fixture District' },
    ]);
  });
});

describe('imports.job.fail: the worker gives up after its last retry', () => {
  async function committingJob(principal: Principal): Promise<ImportJobDto> {
    const job = await startedJob(principal, 'accounts', `Name,Mobile\nGiven Up,${phone()}\n`);
    await run(principal, mapImportJob, { entityId: 1, jobId: job.id, mapping: NAME_PHONE_MAPPING });
    await run(principal, previewImportJob, { entityId: 1, jobId: job.id });
    return run(principal, commitImportJob, { entityId: 1, jobId: job.id });
  }

  it('is denied without imports.write and refused for another company', async () => {
    const job = await committingJob(gm1);
    await expect(run(caller, failImportJob, { entityId: 1, jobId: job.id })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(gm2, failImportJob, { entityId: 1, jobId: job.id })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(gm2, failImportJob, { entityId: 2, jobId: job.id })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('stops a committing job at its next batch and announces it; a finished job is left alone', async () => {
    const job = await committingJob(gm1);
    const failed = await run(gm1, failImportJob, { entityId: 1, jobId: job.id });
    expect(failed).toMatchObject({ state: 'failed', failedBatch: 1 });
    const events = await asOutboxPublisher(
      (p) => p<{ payload_json: unknown }[]>`
        select payload_json from outbox_events
         where aggregate_id = ${job.id} and type = 'imports.job.failed'`,
    );
    expect(events.map((e) => e.payload_json)).toEqual([
      expect.objectContaining({ kind: 'accounts', failedBatch: 1, committedRows: 0 }),
    ]);
    // Asked again, nothing changes.
    expect(await run(gm1, failImportJob, { entityId: 1, jobId: job.id })).toMatchObject({
      state: 'failed',
      failedBatch: 1,
    });
  });
});

/** The seeded worker principal, scoped as the sweep scopes it. */
function workers(entityIds: number[]): Principal {
  return principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });
}

describe('files.upload.sweep: uploads that never completed', () => {
  async function pendingUpload(entityId: number, ageHours: number): Promise<string> {
    const fileId = await createReadyImportFile(entityId, gm1.id, { status: 'pending' });
    await asMigrator(
      (m) => m`update files set created_at = now() - make_interval(hours => ${ageHours})
                where id = ${fileId}`,
    );
    return fileId;
  }

  async function statusOf(fileId: string) {
    const [row] = await asMigrator(
      (m) => m<{ status: string; reason: string | null }[]>`
        select status, scan_result->>'rejectReason' as reason from files where id = ${fileId}`,
    );
    return row;
  }

  it('is refused to every person; only the worker principal sweeps', async () => {
    for (const principal of [executive, gm1]) {
      await expect(run(principal, sweepUploads, { olderThanMinutes: 1440 })).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('refuses a stale pending upload of the company as abandoned and names its key', async () => {
    const stale = await pendingUpload(1, 30);
    const fresh = await pendingUpload(1, 1);
    const elsewhere = await pendingUpload(2, 30);
    const worker = workers([1]);
    expect(await asPrincipal(workers([]), (ctx) => staleUploadCompanies(ctx, 1440))).toEqual(
      expect.arrayContaining([1, 2]),
    );
    const swept = await run(worker, sweepUploads, { olderThanMinutes: 1440 });
    expect(swept.abandoned).toBeGreaterThanOrEqual(1);
    expect(swept.keys).toContain(`1/import/${stale}.csv`);
    expect(await statusOf(stale)).toEqual({ status: 'rejected', reason: 'file_upload_abandoned' });
    expect(await statusOf(fresh)).toEqual({ status: 'pending', reason: null });
    // Another company's upload waits for that company's own sweep.
    expect(await statusOf(elsewhere)).toEqual({ status: 'pending', reason: null });
    await run(workers([2]), sweepUploads, { olderThanMinutes: 1440 });
    expect(await statusOf(elsewhere)).toEqual({
      status: 'rejected',
      reason: 'file_upload_abandoned',
    });
  });
});
