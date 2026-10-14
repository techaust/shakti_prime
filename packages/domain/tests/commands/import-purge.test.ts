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
import {
  maskImportIdentity,
  recordImportPurgeFailure,
} from '../../src/commands/imports/mask-identity';
import { purgeImportRows, recordImportFilesDeleted } from '../../src/commands/imports/purge';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { asciiDigits } from '../../src/privacy/number-shapes';
import { getImportReconciliation, listImportRows } from '../../src/queries/imports/import-queries';
import { importFilesToDelete, nextImportJobToCheck } from '../../src/queries/imports/import-purge';
import { verhoeffCheckDigit } from '../../src/privacy/verhoeff';
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
  it('leaves out a column named or headed by an Aadhaar number given to the command directly', async () => {
    // The cells come from the reader, which masked them before the command's transaction began
    // (review L1); the command checks the headers, which costs nothing.
    const fileId = await createReadyImportFile(1, gm.id);
    const job = await run(gm, createImportJob, {
      entityId: 1,
      kind: 'leads',
      fileId,
      format: 'csv',
      columns: ['Name', 'Mobile', 'UID', 'Village', 'Card 4567 8901 2345'],
      rows: [
        ['Ram', phone(), '2345 6789 0123', 'Sikar', '5678 9012 3456'],
        ['Sita', phone(), '3456-7890-1234', 'Churu', ''],
      ],
      leftOutColumns: ['Aadhaar 6789 0123 4567'],
      maskedValues: 2,
    });
    expect(job).toMatchObject({
      columns: ['Name', 'Mobile', 'Village'],
      leftOutColumns: ['Aadhaar XXXX XXXX 4567', 'UID', 'Card XXXX XXXX 2345'],
      maskedValues: 2,
      purgedAt: null,
    });
    const digits = await storedDigits(job.id);
    expect(digits).not.toMatch(/23456789|34567890|56789012/);
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
      await expect(
        run(caller, maskImportIdentity, { entityId: 1, jobId: newId() }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        run(caller, recordImportPurgeFailure, {
          entityId: 1,
          job: 'import-identity-check',
          error: '57014',
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        asPrincipal(caller, (ctx) => nextImportJobToCheck(ctx, 1)),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(
      run(workers([1]), maskImportIdentity, { entityId: 2, jobId: newId() }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(workers([1]), (ctx) => nextImportJobToCheck(ctx, 2)),
    ).rejects.toMatchObject({ code: 'forbidden' });
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
    expect(await checkJob(job.id, requestId)).toBe(1);
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

    // A job checked is not handed out again, and a call for it changes nothing.
    const again = await run(workers(), maskImportIdentity, { entityId: 1, jobId: job.id });
    expect(again).toMatchObject({ jobId: null, done: false });
  });

  it('checks a job of 50,000 rows a thousand rows a call, each call well inside the limits (review M4)', async () => {
    const jobId = await bigEarlierJob(50_000);
    try {
      const times: number[] = [];
      const calls = await checkJob(jobId, newId(), times);
      expect(calls).toBe(50);
      expect(Math.max(...times)).toBeLessThan(10_000);
      const [left] = await asMigrator(
        (m) => m<{ column: number; digits: number; notes: number }[]>`
          select count(*) filter (where raw_json ? 'Aadhaar')::int as column,
                 count(*) filter (where raw_json::text ~ '[0-9]{12}')::int as digits,
                 count(*) filter (where raw_json ->> 'Notes' like 'card XXXXXXXX%')::int as notes
            from import_rows where job_id = ${jobId}`,
      );
      expect(left).toEqual({ column: 0, digits: 0, notes: 50_000 });
      const [job] = await asMigrator(
        (m) => m<{ left_out_columns: string[]; identity_checked_at: Date | null }[]>`
          select left_out_columns, identity_checked_at from import_jobs where id = ${jobId}`,
      );
      expect(job?.left_out_columns).toEqual(['Aadhaar']);
      expect(job?.identity_checked_at).not.toBeNull();
    } finally {
      await dropEarlierJob(jobId);
    }
  }, 300_000);

  it('fails a job it cannot read, records the failure by its code, and checks the others (review M4)', async () => {
    const broken = await bigEarlierJob(3, { brokenColumns: true });
    const good = await bigEarlierJob(3);
    try {
      await expect(
        run(workers(), maskImportIdentity, { entityId: 1, jobId: broken }),
      ).rejects.toBeDefined();
      await run(workers(), recordImportPurgeFailure, {
        entityId: 1,
        job: 'import-identity-check',
        error: 'internal',
      });
      const [run1] = await asMigrator(
        (m) => m<{ error: string | null }[]>`
          select error from retention_runs where job = 'import-identity-check'
           order by started_at desc limit 1`,
      );
      expect(run1?.error).toBe('internal');
      // The next job is handed out past the one that failed.
      const next = await asPrincipal(workers(), (ctx) => nextImportJobToCheck(ctx, 1, [broken]));
      expect(next).not.toBe(broken);
      expect(await checkJob(good, newId())).toBe(1);
    } finally {
      await dropEarlierJob(broken);
      await dropEarlierJob(good);
    }
  });

  it('keeps every mobile number of a phone column the import does not name in English (review M3)', async () => {
    const mobiles = [6, 7, 8, 9, 6, 7].map((first) => {
      const body = `91${String(first)}${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
      // Twelve digits whose check digit holds, so only the column keeps them a phone.
      return `${body}${verhoeffCheckDigit(body)}`;
    });
    for (const header of ['मोबाइल नंबर', 'Ph No', 'Cust']) {
      const csv = `Name,${header},Village\n${mobiles.map((m, i) => `Person ${String(i)},${m},Sikar`).join('\n')}\n`;
      const job = await createdJob(csv);
      expect(job.maskedValues).toBe(0);
      await run(gm, mapImportJob, {
        entityId: 1,
        jobId: job.id,
        mapping: {
          ...mapping,
          columns: { contactName: 'Name', phone: header, village: 'Village' },
        },
      });
      await run(gm, previewImportJob, { entityId: 1, jobId: job.id });
      const rows = await asPrincipal(gm, (ctx) =>
        listImportRows(ctx, { entityId: 1, jobId: job.id, limit: 20 }),
      );
      expect(rows.rows.flatMap((r) => r.errors.map((e) => e.code))).not.toContain('phone_invalid');
      expect(rows.rows.map((r) => r.raw[header])).toEqual(mobiles);
    }
  });

  it('never stores twelve Aadhaar digits among the columns left out, a file with no header included (review M1)', async () => {
    const number = aadhaar();
    const job = await createdJob(
      `Rekha Devi,Rampur,UID ${spaced(number)}\nSita Devi,Churu,UID ${spaced(aadhaar())}\n`,
    );
    expect(job.leftOutColumns).toEqual([`UID XXXX XXXX ${number.slice(-4)}`]);
    const [row] = await asMigrator(
      (m) => m<{ text: string }[]>`
        select left_out_columns::text || columns_json::text as text from import_jobs
         where id = ${job.id}`,
    );
    expect((row?.text ?? '').replace(/\D/g, '')).not.toContain(number.slice(0, 8));
  });
});

/** Checks one job to the end, call after call, and answers how many calls it took. */
async function checkJob(jobId: string, requestId: string, times: number[] = []): Promise<number> {
  let calls = 0;
  for (;;) {
    const started = Date.now();
    const part = await executeCommand(
      workers(),
      { entityIds: [1], requestId },
      maskImportIdentity,
      { entityId: 1, jobId },
    );
    times.push(Date.now() - started);
    if (part.jobId === null) throw new Error('the job was not handed out');
    calls += 1;
    if (part.done) return calls;
  }
}

/**
 * A committed job of company 1 as an import made before the rule left it, written as the table
 * owner: `count` rows, each with an Aadhaar column and a number inside its notes, not yet checked.
 * With `brokenColumns` its columns are not a list, so the pass cannot read it.
 */
async function bigEarlierJob(
  count: number,
  options: { brokenColumns?: boolean } = {},
): Promise<string> {
  const fileId = await createReadyImportFile(1, gm.id);
  const jobId = newId();
  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      await tx`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, state,
                                        total_rows, valid_rows, committed_rows, created_by)
               values (${jobId}, 1, 'leads', ${fileId}, 'csv',
                       ${options.brokenColumns === true ? '{}' : '["Name","Mobile","Aadhaar","Notes"]'}::jsonb,
                       'committed', ${count}, ${count}, ${count}, ${gm.id})`;
      await tx`insert into import_rows (job_id, entity_id, row_no, raw_json, state, created_by)
               select ${jobId}, 1, i,
                      jsonb_build_object('Name', 'Person ' || i, 'Mobile', '98' || lpad(i::text, 8, '0'),
                                         'Aadhaar', '2' || lpad(i::text, 11, '0'),
                                         'Notes', 'card 3' || lpad(i::text, 11, '0')),
                      'committed', ${gm.id}
                 from generate_series(1, ${count}) i`;
    });
  });
  return jobId;
}

async function dropEarlierJob(jobId: string): Promise<void> {
  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      const [job] = await tx<
        { file_id: string }[]
      >`select file_id from import_jobs where id = ${jobId}`;
      await tx`delete from import_rows where job_id = ${jobId}`;
      await tx`delete from import_jobs where id = ${jobId}`;
      if (job !== undefined) await tx`delete from files where id = ${job.file_id}`;
    });
  });
}

/** Whether any of `numbers`, all twelve digits, is still found in any spacing in a job's rows. */
async function hitsIn(jobId: string, numbers: readonly string[]): Promise<boolean> {
  const [row] = await asMigrator(
    (m) => m<{ text: string }[]>`
      select coalesce(string_agg(regexp_replace(raw_json::text || ' ' || coalesce(normalised_json::text, ''),
                                                '([0-9])[ .,/_:()-]{1,3}(?=[0-9])', '\\1', 'g'), ' '), '')
             as text
        from import_rows where job_id = ${jobId}`,
  );
  return numbers.some((n) => (row?.text ?? '').includes(n));
}

describe('imports.file.record_deleted and the files to delete', () => {
  it('is denied to every person, an Executive included, and to another company', async () => {
    const fileId = await createReadyImportFile(1, gm.id);
    for (const caller of [gm, executive]) {
      await expect(
        run(caller, recordImportFilesDeleted, { entityId: 1, fileIds: [fileId] }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        asPrincipal(caller, (ctx) => importFilesToDelete(ctx, 1, { bucket: 'memory' })),
      ).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(
      run(workers([1]), recordImportFilesDeleted, { entityId: 2, fileIds: [fileId] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(workers([1]), (ctx) => importFilesToDelete(ctx, 2, { bucket: 'memory' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists the file of an ended job, not one still in use, and records it deleted once', async () => {
    const ended = await createdJob(`Name,Mobile,Village\nRam,${phone()},Sikar\n`);
    await run(gm, mapImportJob, { entityId: 1, jobId: ended.id, mapping });
    await run(gm, previewImportJob, { entityId: 1, jobId: ended.id });
    await run(gm, commitImportJob, { entityId: 1, jobId: ended.id });
    await run(gm, commitImportBatch, { entityId: 1, jobId: ended.id });
    const open = await createdJob(`Name,Mobile,Village\nSita,${phone()},Churu\n`);

    const listed = await allFilesToDelete();
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
    const after = await allFilesToDelete();
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
 * Every text, JSON and array column of every public table that holds any of `numbers`, all
 * twelve digits, however they were spaced or punctuated: what an Aadhaar number must never leave
 * behind.
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
  const hits: string[] = [];
  await asMigrator(async (m) => {
    for (const { table, column } of columns) {
      // Digits joined only where a separator people use joins them, then each number whole, so
      // the digits of ids, times and counts running together never match by chance (review L8).
      const [row] = await m.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public."${table}"
          where regexp_replace("${column}"::text, '([0-9])[ .,/_:()-]{1,3}(?=[0-9])', '\\1', 'g')
                like any ($1::text[])`,
        [numbers.map((n) => `%${n}%`)],
      );
      if ((row?.n ?? 0) > 0) hits.push(`${table}.${column}`);
    }
  });
  return hits;
}

/** Every import file of company 1 in the test store the purge would delete, page after page. */
async function allFilesToDelete(): Promise<{ id: string }[]> {
  const all: { id: string; createdAt: string }[] = [];
  for (;;) {
    const last = all.at(-1);
    const page = await asPrincipal(workers(), (ctx) =>
      importFilesToDelete(ctx, 1, {
        bucket: 'memory',
        after: last === undefined ? undefined : { createdAt: last.createdAt, id: last.id },
      }),
    );
    all.push(...page);
    if (page.length < 200) return all;
  }
}
