import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type ImportJobDto,
  type ImportReconciliationDto,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { maskImportIdentity } from '../../src/commands/imports/mask-identity';
import { purgeImportRows, recordImportFilesDeleted } from '../../src/commands/imports/purge';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { asciiDigits } from '../../src/privacy/number-shapes';
import { getImportReconciliation, listImportRows } from '../../src/queries/imports/import-queries';
import { importFilesToDelete } from '../../src/queries/imports/import-purge';
import type { z } from 'zod';

// The import's identity-number filter at the command, and the import purge (audit SEC-1) on real
// Postgres: who may run it, for which company, and that a purged job keeps its reconciliation.

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

function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

const workers = (entityIds: number[] = [1]): Principal =>
  principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });

const mapping = {
  columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
  defaults: { pipelineKey: 'farmer_pumps', accountType: 'farm', siteType: 'borewell' },
};

let gm: Principal;
let executive: Principal;

beforeAll(async () => {
  gm = await createTestPrincipal('general_manager', [1]);
  executive = await createTestPrincipal('executive');
});

/** A job from the given CSV or workbook, read as the upload action reads it, then created. */
async function createdJob(file: string | Uint8Array): Promise<ImportJobDto> {
  const bytes = typeof file === 'string' ? new TextEncoder().encode(file) : file;
  const parsed = await parseImportFile(bytes);
  return run(gm, createImportJob, {
    entityId: 1,
    kind: 'leads',
    fileId: await createReadyImportFile(1, gm.id, { size: bytes.length }),
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
    leftOutColumns: parsed.leftOutColumns,
    maskedValues: parsed.maskedValues,
  });
}

/** Moves a job's last change back by `days`, as if nothing had happened to it since. */
async function age(jobId: string, days: number): Promise<void> {
  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      await tx`alter table import_jobs disable trigger user`;
      await tx`update import_jobs set updated_at = now() - make_interval(days => ${days})
               where id = ${jobId}`;
      await tx`alter table import_jobs enable trigger user`;
    });
  });
}

async function reconciliation(jobId: string): Promise<ImportReconciliationDto> {
  return asPrincipal(gm, (ctx) => getImportReconciliation(ctx, { entityId: 1, jobId }));
}

/** The digits of every row the job stored, in ASCII. */
async function storedDigits(jobId: string): Promise<string> {
  const [row] = await asMigrator(
    (m) => m<{ text: string }[]>`
      select coalesce(string_agg(raw_json::text || coalesce(normalised_json::text, ''), ' '), '')
             as text
        from import_rows where job_id = ${jobId}`,
  );
  return asciiDigits(row?.text ?? '').replace(/\D/g, '');
}

describe('imports.job.create keeps no identity number', () => {
  it('leaves out a column of Aadhaar numbers given to the command directly, and masks one in a cell', async () => {
    const fileId = await createReadyImportFile(1, gm.id);
    const job = await run(gm, createImportJob, {
      entityId: 1,
      kind: 'leads',
      fileId,
      format: 'csv',
      columns: ['Name', 'Mobile', 'UID', 'Village'],
      rows: [
        ['Ram', phone(), '2345 6789 0123', 'Sikar, card ३४५६.७८९०.१२३४'],
        ['Sita', phone(), '3456-7890-1234', 'Churu'],
      ],
    });
    expect(job).toMatchObject({
      columns: ['Name', 'Mobile', 'Village'],
      leftOutColumns: ['UID'],
      maskedValues: 1,
      purgedAt: null,
    });
    const digits = await storedDigits(job.id);
    expect(digits).not.toMatch(/23456789|34567890/);
    const rows = await asPrincipal(gm, (ctx) =>
      listImportRows(ctx, { entityId: 1, jobId: job.id, limit: 10 }),
    );
    expect(rows.rows[0]?.raw).toMatchObject({ Village: 'Sikar, card XXXX.XXXX.१२३४' });
  });

  it('refuses rows that hold nothing but Aadhaar numbers', async () => {
    const fileId = await createReadyImportFile(1, gm.id);
    await expect(
      run(gm, createImportJob, {
        entityId: 1,
        kind: 'leads',
        fileId,
        format: 'csv',
        columns: ['Aadhaar'],
        rows: [['2345 6789 0123']],
      }),
    ).rejects.toMatchObject({ details: { reason: 'import_only_identity_numbers' } });
  });
});

describe('imports.job.purge', () => {
  it('is denied to every person, an Executive included', async () => {
    for (const caller of [gm, executive]) {
      await expect(run(caller, purgeImportRows, { entityId: 1 })).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('is refused for a company outside the request', async () => {
    await expect(run(workers([1]), purgeImportRows, { entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('clears what an added import said after the period, and its reconciliation still adds up', async () => {
    const job = await createdJob(
      `Name,Mobile,Village,Aadhaar\nRam,${phone()},Sikar,2345 6789 0123\nSita,${phone()},Churu,\nGopal,12,Idar,\n`,
    );
    expect(job.leftOutColumns).toEqual(['Aadhaar']);
    await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping });
    await run(gm, previewImportJob, { entityId: 1, jobId: job.id });
    await run(gm, commitImportJob, { entityId: 1, jobId: job.id });
    await run(gm, commitImportBatch, { entityId: 1, jobId: job.id });
    const before = await reconciliation(job.id);
    expect(before).toMatchObject({ state: 'committed', fileRows: 3, created: 2, refused: 1 });

    // Within the period nothing is cleared.
    await age(job.id, 29);
    const early = await run(workers(), purgeImportRows, { entityId: 1 });
    expect(early.jobs).toBeGreaterThanOrEqual(0);
    expect((await reconciliation(job.id)).state).toBe('committed');
    expect(await storedDigits(job.id)).not.toBe('');

    await age(job.id, 31);
    const requestId = newId();
    let purged = 0;
    for (;;) {
      const batch = await executeCommand(
        workers(),
        { entityIds: [1], requestId },
        purgeImportRows,
        { entityId: 1 },
      );
      purged += batch.jobs;
      if (!batch.more) break;
    }
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await reconciliation(job.id)).toEqual(before);
    expect(await storedDigits(job.id)).toBe('');
    const rows = await asPrincipal(gm, (ctx) =>
      listImportRows(ctx, { entityId: 1, jobId: job.id, limit: 10 }),
    );
    expect(rows.rows.map((r) => [r.state, r.raw, r.errors.length])).toEqual([
      ['committed', {}, 0],
      ['committed', {}, 0],
      ['invalid', {}, 1],
    ]);

    const audits = await asMigrator(
      (m) => m<{ after_json: unknown; actor_principal_id: string }[]>`
        select after_json, actor_principal_id from audit_logs
         where request_id = ${requestId} and aggregate_id = ${job.id}`,
    );
    expect(audits).toEqual([
      {
        after_json: { purgedAt: expect.any(String) as string },
        actor_principal_id: SYSTEM_WORKERS_PRINCIPAL_ID,
      },
    ]);
  });

  it('stops a job left before adding, which is then neither mapped, checked nor added', async () => {
    const job = await createdJob(`Name,Mobile,Village\nRam,${phone()},Sikar\n`);
    await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping });
    await run(gm, previewImportJob, { entityId: 1, jobId: job.id });
    await age(job.id, 31);
    for (;;) {
      const batch = await run(workers(), purgeImportRows, { entityId: 1 });
      if (!batch.more) break;
    }
    for (const [command, input] of [
      [mapImportJob, { entityId: 1, jobId: job.id, mapping }],
      [previewImportJob, { entityId: 1, jobId: job.id }],
      [commitImportJob, { entityId: 1, jobId: job.id }],
    ] as const) {
      await expect(run(gm, command as Command<z.ZodType, z.ZodType>, input)).rejects.toMatchObject({
        code: 'conflict',
        details: { reason: 'import_job_purged' },
      });
    }
  });
});

/**
 * Puts a job back as an import made before the identity-number rule left it: an Aadhaar column in
 * its columns and in every row, one more in a row's checked input, and the job not yet checked.
 */
async function asBeforeTheFix(jobId: string, numbers: readonly string[]): Promise<void> {
  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      await tx`update import_jobs
                  set columns_json = columns_json || '["Aadhaar"]'::jsonb,
                      left_out_columns = '{}', masked_values = 0, identity_checked_at = null
                where id = ${jobId}`;
      const rows = await tx<{ row_no: number }[]>`
        select row_no from import_rows where job_id = ${jobId} order by row_no`;
      for (const [i, row] of rows.entries()) {
        await tx`update import_rows
                    set raw_json = raw_json || ${tx.json({ Aadhaar: numbers[i % numbers.length] ?? '' })}::jsonb
                  where job_id = ${jobId} and row_no = ${row.row_no}`;
      }
      await tx`update import_rows
                  set normalised_json = jsonb_set(normalised_json, '{note}',
                                                  to_jsonb(${`Aadhaar ${numbers[0] ?? ''} seen`}::text))
                where job_id = ${jobId} and row_no = 1 and normalised_json is not null`;
    });
  });
}

describe('imports.job.mask_identity, the pass over imports made before the rule', () => {
  it('is denied to every person, an Executive included, and refused for another company', async () => {
    for (const caller of [gm, executive]) {
      await expect(run(caller, maskImportIdentity, { entityId: 1 })).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(run(workers([1]), maskImportIdentity, { entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('leaves out the Aadhaar column and masks the rest of an earlier job, and its reconciliation stays', async () => {
    const job = await createdJob(
      `Name,Mobile,Village\nRam,${phone()},Sikar\nSita,${phone()},Churu\nGopal,12,Idar\n`,
    );
    await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping });
    await run(gm, previewImportJob, { entityId: 1, jobId: job.id });
    await run(gm, commitImportJob, { entityId: 1, jobId: job.id });
    await run(gm, commitImportBatch, { entityId: 1, jobId: job.id });
    const before = await reconciliation(job.id);
    const numbers = [aadhaar(), aadhaar(), aadhaar()];
    await asBeforeTheFix(job.id, numbers.map(spaced));
    expect(await hitsIn(job.id, numbers)).toBe(true);

    const requestId = newId();
    const checked: string[] = [];
    for (;;) {
      const call = await executeCommand(
        workers(),
        { entityIds: [1], requestId },
        maskImportIdentity,
        { entityId: 1 },
      );
      if (call.jobId === null) break;
      checked.push(call.jobId);
    }
    expect(checked).toContain(job.id);
    expect(await hitsIn(job.id, numbers)).toBe(false);
    expect(await reconciliation(job.id)).toEqual(before);
    const [row] = await asMigrator(
      (m) => m<
        {
          columns_json: unknown;
          left_out_columns: string[];
          masked_values: number;
          identity_checked_at: Date | null;
        }[]
      >`
        select columns_json, left_out_columns, masked_values, identity_checked_at
          from import_jobs where id = ${job.id}`,
    );
    expect(row).toMatchObject({
      columns_json: ['Name', 'Mobile', 'Village'],
      left_out_columns: ['Aadhaar'],
      masked_values: 1,
    });
    expect(row?.identity_checked_at).not.toBeNull();
    const audits = await asMigrator(
      (m) => m<{ after_json: unknown }[]>`
        select after_json from audit_logs where request_id = ${requestId} and aggregate_id = ${job.id}`,
    );
    expect(audits).toEqual([{ after_json: { leftOutColumns: 1, maskedValues: 1 } }]);

    // Once every job is checked, a call finds none and changes nothing.
    const again = await run(workers(), maskImportIdentity, { entityId: 1 });
    expect(again).toMatchObject({ jobId: null, more: false });
  });
});

/** Whether any of `numbers` is still found, in any spacing, in a job's stored rows. */
async function hitsIn(jobId: string, numbers: readonly string[]): Promise<boolean> {
  const digits = await storedDigits(jobId);
  return numbers.some((n) => digits.includes(n.slice(0, 8)));
}

describe('imports.file.record_deleted and the files to delete', () => {
  it('is denied to every person, an Executive included, and to another company', async () => {
    const fileId = await createReadyImportFile(1, gm.id);
    for (const caller of [gm, executive]) {
      await expect(
        run(caller, recordImportFilesDeleted, { entityId: 1, fileIds: [fileId] }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(asPrincipal(caller, (ctx) => importFilesToDelete(ctx, 1))).rejects.toMatchObject(
        {
          code: 'forbidden',
        },
      );
    }
    await expect(
      run(workers([1]), recordImportFilesDeleted, { entityId: 2, fileIds: [fileId] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(workers([1]), (ctx) => importFilesToDelete(ctx, 2)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists the file of an ended job, not one still in use, and records it deleted once', async () => {
    const ended = await createdJob(`Name,Mobile,Village\nRam,${phone()},Sikar\n`);
    await run(gm, mapImportJob, { entityId: 1, jobId: ended.id, mapping });
    await run(gm, previewImportJob, { entityId: 1, jobId: ended.id });
    await run(gm, commitImportJob, { entityId: 1, jobId: ended.id });
    await run(gm, commitImportBatch, { entityId: 1, jobId: ended.id });
    const open = await createdJob(`Name,Mobile,Village\nSita,${phone()},Churu\n`);

    const listed = await asPrincipal(workers(), (ctx) => importFilesToDelete(ctx, 1));
    const ids = listed.map((f) => f.id);
    expect(ids).toContain(ended.file.id);
    expect(ids).not.toContain(open.file.id);

    const requestId = newId();
    const done = await executeCommand(
      workers(),
      { entityIds: [1], requestId },
      recordImportFilesDeleted,
      { entityId: 1, fileIds: [ended.file.id, open.file.id] },
    );
    expect(done).toEqual({ entityId: 1, deleted: 1 });
    const again = await run(workers(), recordImportFilesDeleted, {
      entityId: 1,
      fileIds: [ended.file.id],
    });
    expect(again.deleted).toBe(0);
    const after = await asPrincipal(workers(), (ctx) => importFilesToDelete(ctx, 1));
    expect(after.map((f) => f.id)).not.toContain(ended.file.id);
    const job = await asPrincipal(gm, (ctx) =>
      getImportReconciliation(ctx, { entityId: 1, jobId: ended.id }),
    );
    expect(job.state).toBe('committed');
    const audits = await asMigrator(
      (m) => m<{ aggregate_id: string }[]>`
        select aggregate_id from audit_logs where request_id = ${requestId}`,
    );
    expect(audits).toEqual([{ aggregate_id: ended.file.id }]);
  });
});

/** Twelve digits no earlier run used, beginning 2 to 9 as an Aadhaar number does. */
function aadhaar(): string {
  return `${String(2 + Math.floor(Math.random() * 8))}${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
}

const spaced = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

/** A workbook of one sheet with the given rows, as a person saves it from Excel. */
async function workbook(rows: unknown[][]): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Leads');
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

describe('no Aadhaar number from an import is found anywhere in the database (audit SEC-1)', () => {
  it('after a workbook with an Aadhaar column and a file with one inside an address are imported, and after the purge', async () => {
    const numbers = [aadhaar(), aadhaar(), aadhaar(), aadhaar()];
    const [first = '', second = '', third = '', fourth = ''] = numbers;
    // A subsidy list as the client keeps it: the Aadhaar column holds a number cell, a spaced
    // text and a hyphenated one.
    const book = await workbook([
      ['PM-KUSUM applicants'],
      ['Name', 'Mobile', 'Aadhaar No', 'Village'],
      ['Ram', phone(), Number(first), 'Sikar'],
      ['Sita', phone(), spaced(second), 'Churu'],
      ['Gopal', phone(), third.replace(/(\d{4})(?=\d)/g, '$1-'), 'Idar'],
    ]);
    const fromBook = await createdJob(book);
    expect(fromBook).toMatchObject({
      format: 'xlsx',
      leftOutColumns: ['Aadhaar No'],
      totalRows: 3,
    });
    const fromAddress = await createdJob(
      `Name,Mobile,Village,Address\nMeera,${phone()},Nagaur,"H 9, Main road, Aadhaar ${spaced(fourth)}"\n`,
    );
    expect(fromAddress).toMatchObject({ leftOutColumns: [], maskedValues: 1 });
    for (const job of [fromBook, fromAddress]) {
      await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping });
      await run(gm, previewImportJob, { entityId: 1, jobId: job.id });
      await run(gm, commitImportJob, { entityId: 1, jobId: job.id });
      await run(gm, commitImportBatch, { entityId: 1, jobId: job.id });
    }
    expect(await hitsOf(numbers)).toEqual([]);

    for (const job of [fromBook, fromAddress]) await age(job.id, 31);
    for (;;) {
      const batch = await run(workers(), purgeImportRows, { entityId: 1 });
      if (!batch.more) break;
    }
    expect(await hitsOf(numbers)).toEqual([]);
    // The last four digits of the address's number were all the import kept, and the purge
    // cleared those too.
    expect(await storedDigits(fromAddress.id)).toBe('');
  }, 240_000);
});

/**
 * Every text, JSON and array column of every public table that holds the first eight digits of
 * any of `numbers`, however they were spaced or punctuated: what an Aadhaar number must never
 * leave behind.
 */
async function hitsOf(numbers: readonly string[]): Promise<string[]> {
  const columns = await asMigrator(
    (m) => m<{ table: string; column: string }[]>`
      select c.table_name as table, c.column_name as column
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY')
       order by 1, 2`,
  );
  expect(columns.length).toBeGreaterThan(100);
  const heads = numbers.map((n) => n.slice(0, 8));
  const hits: string[] = [];
  await asMigrator(async (m) => {
    for (const { table, column } of columns) {
      const [row] = await m.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public."${table}"
          where regexp_replace("${column}"::text, '[^0-9]', '', 'g') like any ($1::text[])`,
        [heads.map((h) => `%${h}%`)],
      );
      if ((row?.n ?? 0) > 0) hits.push(`${table}.${column}`);
    }
  });
  return hits;
}
