import {
  newId,
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
import { getImportJob, listImportRows } from '../../src/queries/imports/import-queries';

// The import kinds of the imports upgrade (docs/03-roadmap-appendix/phase1.md §6.3) on real Postgres: customers
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

/** The fixture PINs this file has drawn, so no two of its tests share one. */
const drawnPins = new Set<string>();

/**
 * A fixture PIN with no office left by an earlier run: one of 999950 to 999989, never one this
 * file drew before. 999901 is the CRM fixture's; the database suite draws from 999910 to 999949.
 */
async function freshPin(): Promise<string> {
  const free = Array.from({ length: 40 }, (_, i) => `9999${String(50 + i)}`).filter(
    (code) => !drawnPins.has(code),
  );
  const code = free[Math.floor(Math.random() * free.length)];
  if (code === undefined) throw new Error('the fixture PINs of this file are used up');
  drawnPins.add(code);
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
    // The repeat's site is the first row's own, so nothing more is added.
    expect(rows[2]?.dedupe).toEqual({ inFileRowNo: 1, existing: [], site: 'same' });
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

describe('imports.job.fail: the worker gives up on a job it can take no further', () => {
  async function committingJob(principal: Principal): Promise<ImportJobDto> {
    const job = await startedJob(principal, 'accounts', `Name,Mobile\nGiven Up,${phone()}\n`);
    await run(principal, mapImportJob, { entityId: 1, jobId: job.id, mapping: NAME_PHONE_MAPPING });
    await run(principal, previewImportJob, { entityId: 1, jobId: job.id });
    return run(principal, commitImportJob, { entityId: 1, jobId: job.id });
  }

  it('is the worker principal’s alone, in the job’s company', async () => {
    const job = await committingJob(gm1);
    // No person stops a job this way, not even the one who started it.
    for (const principal of [caller, gm1, executive]) {
      await expect(
        run(principal, failImportJob, { entityId: 1, jobId: job.id }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(
      run(workers([2]), failImportJob, { entityId: 1, jobId: job.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(workers([2]), failImportJob, { entityId: 2, jobId: job.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('stops a committing job at its next batch and announces it; a finished job is left alone', async () => {
    const job = await committingJob(gm1);
    const failed = await run(workers([1]), failImportJob, { entityId: 1, jobId: job.id });
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
    expect(await run(workers([1]), failImportJob, { entityId: 1, jobId: job.id })).toMatchObject({
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

/** A customer's sites, read past the policies, in the order made. */
async function sitesOf(accountId: string) {
  return asMigrator(
    (m) => m<{ village: string; type: string }[]>`
      select village, type from customer_sites where account_id = ${accountId}
       order by created_at, village`,
  );
}

async function archivedOf(ids: readonly string[]): Promise<Record<string, boolean>> {
  const rows = await asMigrator(
    (m) => m<{ id: string; archived: boolean }[]>`
      select id, archived_at is not null as archived from accounts where id = any(${[...ids]}::uuid[])`,
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.archived]));
}

describe('customers files after review', () => {
  it('adds the different site of a repeated row to the customer, and says so', async () => {
    const number = phone();
    const job = await startedJob(
      gm1,
      'accounts',
      [
        'Name,Mobile,Village',
        `Two Sites,${number},Sikar`,
        `Two Sites,${number},Churu`,
        `Two Sites,${number},sikar`,
        `Two Sites,${number},`,
      ].join('\n') + '\n',
    );
    await run(gm1, mapImportJob, { entityId: 1, jobId: job.id, mapping: OWN_COMPANY_MAPPING });
    const previewed = await run(gm1, previewImportJob, { entityId: 1, jobId: job.id });
    expect(previewed).toMatchObject({ validRows: 1, skippedRows: 3, entityIds: [1] });
    const rows = await rowsOf(gm1, job.id);
    expect(rows.map((r) => r.dedupe)).toEqual([
      null,
      { inFileRowNo: 1, existing: [], site: 'added' },
      { inFileRowNo: 1, existing: [], site: 'same' },
      { inFileRowNo: 1, existing: [] },
    ]);
    await committed(gm1, previewed);
    const made = (await rowsOf(gm1, job.id))[0]?.createdId ?? '';
    expect(await sitesOf(made)).toEqual([
      { village: 'Churu', type: 'borewell' },
      { village: 'Sikar', type: 'borewell' },
    ]);
  });

  it('adds a row to the customer the importer already sees with its number, making no second one', async () => {
    const number = phone();
    const existing = await run(executive, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Known Farmer', phone: number },
      account: { type: 'farm' },
    });
    const job = await startedJob(
      executive,
      'accounts',
      [
        'Name,Mobile,Village,Company',
        `Known Farmer again,${number},Sikar,SMP`,
        `Known Farmer again,${number},Churu,SMP`,
      ].join('\n') + '\n',
    );
    await run(executive, mapImportJob, { entityId: 1, jobId: job.id, mapping: ACCOUNT_MAPPING });
    const previewed = await run(executive, previewImportJob, { entityId: 1, jobId: job.id });
    expect(previewed).toMatchObject({ validRows: 1, skippedRows: 1, entityIds: [1, 2] });
    const [row, repeat] = await rowsOf(executive, job.id);
    expect(row?.dedupe).toMatchObject({
      linkedTo: existing.account.id,
      site: 'kept',
      existing: [{ accountId: existing.account.id, matchedBy: 'phone' }],
    });
    // The repeat's different site is not said to be added: a linked row adds no site.
    expect(repeat?.dedupe).toEqual({ inFileRowNo: 1, existing: [], site: 'kept' });

    expect(await committed(executive, previewed)).toMatchObject({
      state: 'committed',
      committedRows: 1,
    });
    const [done] = await rowsOf(executive, job.id);
    expect(done).toMatchObject({ createdType: 'account_link', createdId: existing.account.id });
    expect(await companiesOf(existing.account.id)).toEqual([1, 2]);
    // No second customer holds the number.
    const holders = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(distinct ac.account_id)::int as n
          from contact_phones cp join account_contacts ac on ac.contact_id = cp.contact_id
         where cp.e164 = (select e164 from contact_phones cp2
                            join account_contacts ac2 on ac2.contact_id = cp2.contact_id
                           where ac2.account_id = ${existing.account.id} limit 1)`,
    );
    expect(holders[0]?.n).toBe(1);
    // Neither the linked row's site nor its repeat's is added: the customer's sites stay as they are.
    expect(await sitesOf(existing.account.id)).toEqual([]);

    // Undoing the import leaves the customer, with the company the row added.
    await run(executive, rollbackImportJob, { entityId: 1, jobId: job.id });
    expect(await archivedOf([existing.account.id])).toEqual({ [existing.account.id]: false });
    expect(await companiesOf(existing.account.id)).toEqual([1, 2]);
  });

  it('links a customer seen only through another of the importer’s companies, as the helper answers', async () => {
    const gm13 = await createTestPrincipal('general_manager', [1, 3]);
    const gm3 = await createTestPrincipal('general_manager', [3]);
    const [number, gone] = [phone(), phone()];
    const elsewhere = await run(gm3, createLead, {
      entityId: 3,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Company Three Farmer', phone: number },
      account: { type: 'farm' },
    });
    const archived = await run(gm3, createLead, {
      entityId: 3,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Archived Since', phone: gone },
      account: { type: 'farm' },
    });
    const job = await startedJob(
      gm13,
      'accounts',
      `Name,Mobile,Village\nCompany Three Farmer,${number},Sikar\nArchived Since,${gone},Churu\n`,
    );
    await run(gm13, mapImportJob, { entityId: 1, jobId: job.id, mapping: OWN_COMPANY_MAPPING });
    const previewed = await run(gm13, previewImportJob, { entityId: 1, jobId: job.id });
    // The rows name company 1 alone; the customers were seen through company 3.
    expect(previewed).toMatchObject({ validRows: 2, entityIds: [1, 3] });
    expect((await rowsOf(gm13, job.id)).map((r) => r.dedupe?.linkedTo)).toEqual([
      elsewhere.account.id,
      archived.account.id,
    ]);
    // As a job stored before those companies were recorded: the commit no longer depends on the
    // request seeing the customer, only on the helper's answer.
    await asMigrator((m) => m`update import_jobs set entity_ids = '{1}' where id = ${job.id}`);
    await asMigrator(
      (m) => m`update accounts set archived_at = now() where id = ${archived.account.id}`,
    );
    await run(gm13, commitImportJob, { entityId: 1, jobId: job.id }, [1]);
    let current = await run(gm13, commitImportBatch, { entityId: 1, jobId: job.id }, [1]);
    while (current.state === 'committing') {
      current = await run(gm13, commitImportBatch, { entityId: 1, jobId: job.id }, [1]);
    }
    expect(current).toMatchObject({ state: 'committed', committedRows: 2 });
    const [linkedRow, remade] = await rowsOf(gm13, job.id);
    expect(linkedRow).toMatchObject({
      createdType: 'account_link',
      createdId: elsewhere.account.id,
    });
    expect(await companiesOf(elsewhere.account.id)).toEqual([1, 3]);
    // Only a customer archived since the check is made anew.
    expect(remade).toMatchObject({ createdType: 'account' });
    expect(remade?.createdId).not.toBe(archived.account.id);
    const holders = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(distinct ac.account_id)::int as n
          from contact_phones cp
          join account_contacts ac on ac.contact_id = cp.contact_id
          join accounts a on a.id = ac.account_id and a.archived_at is null
         where cp.e164 = (select e164 from contact_phones cp2
                            join account_contacts ac2 on ac2.contact_id = cp2.contact_id
                           where ac2.account_id = ${elsewhere.account.id} limit 1)`,
    );
    expect(holders[0]?.n).toBe(1);
  });

  it('refuses to add or undo rows in a request that leaves out a company they name', async () => {
    const job = await startedJob(
      executive,
      'accounts',
      `Name,Mobile,Village,Company\nTwo Companies,${phone()},Sikar,SMP\n`,
    );
    await run(executive, mapImportJob, { entityId: 1, jobId: job.id, mapping: ACCOUNT_MAPPING });
    await run(executive, previewImportJob, { entityId: 1, jobId: job.id });
    const outOfReach = { code: 'forbidden', details: { reason: 'import_companies_out_of_reach' } };
    await expect(
      run(executive, commitImportJob, { entityId: 1, jobId: job.id }, [1]),
    ).rejects.toMatchObject(outOfReach);
    // The worker, acting for the job's own company alone, stops at the first batch too.
    await run(executive, commitImportJob, { entityId: 1, jobId: job.id });
    await expect(
      run(executive, commitImportBatch, { entityId: 1, jobId: job.id }, [1]),
    ).rejects.toMatchObject(outOfReach);
    let current = await run(executive, commitImportBatch, { entityId: 1, jobId: job.id });
    while (current.state === 'committing') {
      current = await run(executive, commitImportBatch, { entityId: 1, jobId: job.id });
    }
    expect(current.state).toBe('committed');
    await expect(
      run(executive, rollbackImportJob, { entityId: 1, jobId: job.id }, [1]),
    ).rejects.toMatchObject(outOfReach);
  });

  it('keeps on rollback a customer another company took on or a consent rests on, unseen by the caller', async () => {
    const [taken, consented, free] = [phone(), phone(), phone()];
    const job = await startedJob(
      gm1,
      'accounts',
      [
        'Name,Mobile,Village',
        `Taken Elsewhere,${taken},Sikar`,
        `Consented One,${consented},Sikar`,
        `Free One,${free},Sikar`,
      ].join('\n') + '\n',
    );
    await run(gm1, mapImportJob, { entityId: 1, jobId: job.id, mapping: OWN_COMPANY_MAPPING });
    await committed(gm1, await run(gm1, previewImportJob, { entityId: 1, jobId: job.id }));
    const [takenId = '', consentedId = '', freeId = ''] = (await rowsOf(gm1, job.id)).map(
      (r) => r.createdId ?? '',
    );
    // Company 2 takes the first customer on, and the second's consent is recorded: neither is
    // anything company 1's General Manager can see.
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
          values (${newId()}, ${takenId}, 2, ${gm2.id}, ${gm2.id})`;
        await tx`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
          select ${newId()}, ac.contact_id, 'call', 'service', 'verbal', 'v1', now(), ${gm2.id}
            from account_contacts ac where ac.account_id = ${consentedId}`;
      }),
    );
    const rolled = await run(gm1, rollbackImportJob, { entityId: 1, jobId: job.id });
    expect(rolled.state).toBe('rolled_back');
    expect(await archivedOf([takenId, consentedId, freeId])).toEqual({
      [takenId]: false,
      [consentedId]: false,
      [freeId]: true,
    });
  });

  it('starts a job only from the caller’s own upload of the company', async () => {
    const csv = `Name,Mobile\nOwn File,${phone()}\n`;
    const parsed = await parseImportFile(new TextEncoder().encode(csv));
    const input = (entityId: number, fileId: string) => ({
      entityId,
      kind: 'leads',
      fileId,
      format: parsed.format,
      columns: parsed.columns,
      rows: parsed.rows,
    });
    const missing = { code: 'not_found', details: { reason: 'import_file_missing' } };
    // Another company's file, named in the caller's company or in that one.
    const elsewhere = await createReadyImportFile(2, gm2.id);
    await expect(run(gm1, createImportJob, input(1, elsewhere))).rejects.toMatchObject(missing);
    await expect(run(gm1, createImportJob, input(2, elsewhere))).rejects.toMatchObject({
      code: 'forbidden',
    });
    // A colleague's file of the same company.
    const colleague = await createTestPrincipal('general_manager', [1]);
    const theirs = await createReadyImportFile(1, colleague.id);
    await expect(run(gm1, createImportJob, input(1, theirs))).rejects.toMatchObject(missing);
    expect(await run(colleague, createImportJob, input(1, theirs))).toMatchObject({
      createdBy: colleague.id,
    });
  });

  it('refuses the same content again only while a job of it has added rows', async () => {
    const sha256 = 'c'.repeat(32) + newId().replace(/-/g, '');
    const csv = `Name,Mobile\nSame Content,${phone()}\n`;
    const parsed = await parseImportFile(new TextEncoder().encode(csv));
    const start = async () =>
      run(gm1, createImportJob, {
        entityId: 1,
        kind: 'leads',
        fileId: await createReadyImportFile(1, gm1.id, { sha256 }),
        format: parsed.format,
        columns: parsed.columns,
        rows: parsed.rows,
      });
    const setState = (jobId: string, state: string, committedRows: number) =>
      asMigrator(
        (m) => m`update import_jobs set state = ${state}, valid_rows = 1,
                   committed_rows = ${committedRows} where id = ${jobId}`,
      );
    const first = await start();
    // Left before adding: the same list may be started again.
    const second = await start();
    await setState(first.id, 'rolled_back', 0);
    await setState(second.id, 'failed', 0);
    const third = await start();
    await setState(third.id, 'committed', 1);
    await expect(start()).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'import_file_duplicate' },
    });
    await setState(third.id, 'failed', 1);
    await expect(start()).rejects.toMatchObject({ details: { reason: 'import_file_duplicate' } });
  });

  it('commits only one of two jobs of the same content started side by side', async () => {
    const sha256 = 'd'.repeat(32) + newId().replace(/-/g, '');
    const csv = `Name,Mobile,Village\nSide By Side,${phone()},Sikar\n`;
    const parsed = await parseImportFile(new TextEncoder().encode(csv));
    const previewedJob = async () => {
      const job = await run(gm1, createImportJob, {
        entityId: 1,
        kind: 'accounts',
        fileId: await createReadyImportFile(1, gm1.id, { sha256 }),
        format: parsed.format,
        columns: parsed.columns,
        rows: parsed.rows,
      });
      await run(gm1, mapImportJob, { entityId: 1, jobId: job.id, mapping: OWN_COMPANY_MAPPING });
      return run(gm1, previewImportJob, { entityId: 1, jobId: job.id });
    };
    // Both start while neither has added anything.
    const first = await previewedJob();
    const second = await previewedJob();
    const duplicate = { code: 'conflict', details: { reason: 'import_file_duplicate' } };
    // While the first adds its rows, and once it has, the second is refused.
    await run(gm1, commitImportJob, { entityId: 1, jobId: first.id });
    await expect(
      run(gm1, commitImportJob, { entityId: 1, jobId: second.id }),
    ).rejects.toMatchObject(duplicate);
    expect(await committed(gm1, first)).toMatchObject({ state: 'committed', committedRows: 1 });
    await expect(
      run(gm1, commitImportJob, { entityId: 1, jobId: second.id }),
    ).rejects.toMatchObject(duplicate);
    expect(
      await asPrincipal(gm1, (ctx) => getImportJob(ctx, { entityId: 1, jobId: second.id })),
    ).toMatchObject({
      state: 'previewed',
      committedRows: 0,
    });
    // Once the first is undone, the second may add the same list.
    await run(gm1, rollbackImportJob, { entityId: 1, jobId: first.id });
    expect(await committed(gm1, second)).toMatchObject({ state: 'committed', committedRows: 1 });
  });
});

describe('a PIN code import checks the waiting sites again', () => {
  it('clears the flag of sites whose PIN it adds and fills their place; its rollback flags them again', async () => {
    const code = await freshPin();
    const lead = await run(gm2, createLead, {
      entityId: 2,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Waiting Site', phone: phone() },
      account: { type: 'farm' },
      site: { type: 'borewell', village: 'Fixture village', pin: code },
    });
    const siteOf = async () => {
      const [site] = await asMigrator(
        (m) => m<{ tehsil: string | null; district: string | null; pin_needs_review: boolean }[]>`
          select tehsil, district, pin_needs_review from customer_sites
           where account_id = ${lead.account.id}`,
      );
      return site;
    };
    expect(await siteOf()).toEqual({ tehsil: null, district: null, pin_needs_review: true });

    const job = await startedJob(
      executive,
      'pin_codes',
      `Pincode,OfficeName,Taluk,District,StateName\n${code},Fixture Waiting B.O,Fixture Taluk,Fixture District,RAJASTHAN\n`,
    );
    await run(executive, mapImportJob, { entityId: 1, jobId: job.id, mapping: PIN_MAPPING });
    await committed(
      executive,
      await run(executive, previewImportJob, { entityId: 1, jobId: job.id }),
    );
    expect(await siteOf()).toEqual({
      tehsil: 'Fixture Taluk',
      district: 'Fixture District',
      pin_needs_review: false,
    });

    await run(executive, rollbackImportJob, { entityId: 1, jobId: job.id });
    expect(await siteOf()).toEqual({
      tehsil: 'Fixture Taluk',
      district: 'Fixture District',
      pin_needs_review: true,
    });
  });

  it('corrects an office named in another case instead of adding it twice', async () => {
    const code = await freshPin();
    const header = 'Pincode,OfficeName,Taluk,District,StateName';
    for (const [name, district] of [
      ['Fixture Case B.O', 'Fixture First'],
      ['FIXTURE CASE B.O', 'Fixture Second'],
    ] as const) {
      const job = await startedJob(
        executive,
        'pin_codes',
        `${header}\n${code},${name},Fixture Taluk,${district},RAJASTHAN\n`,
      );
      await run(executive, mapImportJob, { entityId: 1, jobId: job.id, mapping: PIN_MAPPING });
      await committed(
        executive,
        await run(executive, previewImportJob, { entityId: 1, jobId: job.id }),
      );
    }
    const offices = await asMigrator(
      (m) => m<{ office_name: string; district: string }[]>`
        select office_name, district from pin_codes where pin = ${code}`,
    );
    expect(offices).toEqual([{ office_name: 'Fixture Case B.O', district: 'Fixture Second' }]);
  });
});
