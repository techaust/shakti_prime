import { newId, type ImportJobDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
} from '@shakti/db/testing';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { rollbackImportJob } from '../../src/commands/imports/rollback-job';
import { createLead } from '../../src/commands/crm/create-lead';
import { parseImportFile } from '../../src/imports/parse';
import { importRowKey } from '../../src/imports/row-key';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listImportRows } from '../../src/queries/imports/import-queries';
import type { z } from 'zod';

afterAll(closeDb);
// Each commit runs a lead command per row; a loaded CI machine needs more than the default.
vi.setConfig({ testTimeout: 60_000 });

/** A mobile number no earlier run used, so dedupe finds only what the test made. */
function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

function run<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<z.output<O>> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

/** The command input for a CSV file, parsed the way the upload action parses it. */
async function fileInput(entityId: number, csv: string) {
  const bytes = new TextEncoder().encode(csv);
  const parsed = await parseImportFile(bytes);
  const id = newId();
  return {
    entityId,
    kind: 'leads' as const,
    file: {
      name: 'fair-leads.csv',
      contentType: 'text/csv',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bucket: 'memory',
      key: `imports/${String(entityId)}/${id}`,
    },
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  };
}

const mapping = {
  columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
  defaults: { pipelineKey: 'farmer_pumps', accountType: 'farm', siteType: 'borewell' },
};

/** A job with the given rows, mapped and previewed. */
async function previewedJob(
  principal: Principal,
  rows: string[],
  entityId = 1,
): Promise<ImportJobDto> {
  const created = await run(
    principal,
    createImportJob,
    await fileInput(entityId, `Name,Mobile,Village\n${rows.join('\n')}\n`),
  );
  await run(principal, mapImportJob, { entityId, jobId: created.id, mapping });
  return run(principal, previewImportJob, { entityId, jobId: created.id });
}

async function rowsOf(principal: Principal, jobId: string, entityId = 1) {
  const page = await asPrincipal(principal, (ctx) =>
    listImportRows(ctx, { entityId, jobId, limit: 200 }),
  );
  return page.rows;
}

async function liveLeadCount(ids: readonly string[]): Promise<number> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from opportunities
                               where id = any(${ids}::uuid[]) and archived_at is null`,
  );
  return row?.n ?? -1;
}

async function jobStateOf(jobId: string): Promise<string | undefined> {
  const [row] = await asMigrator(
    (m) => m<{ state: string }[]>`select state from import_jobs where id = ${jobId}`,
  );
  return row?.state;
}

let gm: Principal;
let gm2: Principal;
let executive: Principal;

beforeAll(async () => {
  gm = await createTestPrincipal('general_manager', [1]);
  gm2 = await createTestPrincipal('general_manager', [2]);
  executive = await createTestPrincipal('executive');
});

describe('imports: permission and entity', () => {
  it('is denied to a role without imports.write, before anything is stored', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const input = await fileInput(1, 'Name,Mobile\nRam,9876543210\n');
    await expect(run(caller, createImportJob, input)).rejects.toMatchObject({ code: 'forbidden' });
    const [row] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from files where key = ${input.file.key}`,
    );
    expect(row?.n).toBe(0);
  });

  it('refuses an entity outside the request, and another entity’s job', async () => {
    await expect(
      run(gm2, createImportJob, await fileInput(1, 'Name,Mobile\nRam,9876543210\n')),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const job = await run(gm, createImportJob, await fileInput(1, 'Name,Mobile\nA,9876543210\n'));
    await expect(
      run(gm2, mapImportJob, { entityId: 1, jobId: job.id, mapping }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(gm2, mapImportJob, { entityId: 2, jobId: job.id, mapping }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'import_job_missing' } });
  });

  it('refuses preview, commit, batch and rollback to a role without imports.write', async () => {
    const job = await previewedJob(gm, [`Guarded,${phone()},Sikar`]);
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    for (const command of [
      previewImportJob,
      commitImportJob,
      commitImportBatch,
      rollbackImportJob,
    ]) {
      await expect(
        run(caller, command as Command<z.ZodType, z.ZodType>, { entityId: 1, jobId: job.id }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(await jobStateOf(job.id)).toBe('previewed');
  });

  it('refuses preview, commit, batch and rollback for another company', async () => {
    const job = await previewedJob(gm, [`Other company,${phone()},Churu`]);
    for (const command of [
      previewImportJob,
      commitImportJob,
      commitImportBatch,
      rollbackImportJob,
    ]) {
      const guarded = command as Command<z.ZodType, z.ZodType>;
      // A company outside the caller's request is refused before the job is looked up.
      await expect(run(gm2, guarded, { entityId: 1, jobId: job.id })).rejects.toMatchObject({
        code: 'forbidden',
      });
      // Their own company does not reach a job that belongs to another one.
      await expect(run(gm2, guarded, { entityId: 2, jobId: job.id })).rejects.toMatchObject({
        code: 'not_found',
        details: { reason: 'import_job_missing' },
      });
    }
    expect(await jobStateOf(job.id)).toBe('previewed');
  });

  it('refuses commit and batch without the lead and customer rights, and rollback without the lead right', async () => {
    const without = (key: string): Principal => ({
      ...gm,
      permissions: gm.permissions.filter((p) => p.key !== key),
    });
    const noLeadWrite = without('crm.lead.write');
    const noAccountWrite = without('crm.account.write');
    // Both callers still hold imports.write, so only the extra rights can refuse them.
    expect(noLeadWrite.permissions.some((p) => p.key === 'imports.write')).toBe(true);
    expect(noAccountWrite.permissions.some((p) => p.key === 'imports.write')).toBe(true);

    const job = await previewedJob(gm, [`Needs rights,${phone()},Nagaur`]);
    for (const caller of [noLeadWrite, noAccountWrite]) {
      await expect(
        run(caller, commitImportJob, { entityId: 1, jobId: job.id }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(await jobStateOf(job.id)).toBe('previewed');

    await run(gm, commitImportJob, { entityId: 1, jobId: job.id });
    for (const caller of [noLeadWrite, noAccountWrite]) {
      await expect(
        run(caller, commitImportBatch, { entityId: 1, jobId: job.id }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(await jobStateOf(job.id)).toBe('committing');

    await run(gm, commitImportBatch, { entityId: 1, jobId: job.id });
    await expect(
      run(noLeadWrite, rollbackImportJob, { entityId: 1, jobId: job.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await jobStateOf(job.id)).toBe('committed');
    // The customer right is not needed to undo: rollback archives leads and leaves customers.
    expect(
      (await run(noAccountWrite, rollbackImportJob, { entityId: 1, jobId: job.id })).state,
    ).toBe('rolled_back');
  });

  it('refuses a kind that cannot be imported yet', async () => {
    const input = { ...(await fileInput(1, 'Name\nWidget\n')), kind: 'items' };
    await expect(run(gm, createImportJob, input)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('imports: create, map and preview', () => {
  it('stores the file, the job and every row, and audits a summary without the rows', async () => {
    const input = await fileInput(
      1,
      `Name,Mobile,Village\nRam,${phone()},Sikar\nSita,${phone()},\n`,
    );
    const requestId = newId();
    const job = await executeCommand(gm, { entityIds: [1], requestId }, createImportJob, input);
    expect(job).toMatchObject({
      state: 'uploaded',
      kind: 'leads',
      format: 'csv',
      columns: ['Name', 'Mobile', 'Village'],
      totalRows: 2,
      file: { name: 'fair-leads.csv' },
      createdBy: gm.id,
    });
    const rows = await rowsOf(gm, job.id);
    expect(rows.map((r) => [r.rowNo, r.state, r.raw.Name])).toEqual([
      [1, 'pending', 'Ram'],
      [2, 'pending', 'Sita'],
    ]);
    const [row] = await asMigrator(
      (m) => m<{ input_json: Record<string, unknown> }[]>`
        select input_json from audit_logs where request_id = ${requestId} and command = 'imports.job.create'`,
    );
    expect(row?.input_json).toMatchObject({ rows: 2, columns: 3, kind: 'leads' });
    expect(JSON.stringify(row?.input_json)).not.toContain('Sita');
  });

  it('replays a repeat with the same key, and refuses the same file for a second job', async () => {
    const input = await fileInput(1, `Name,Mobile\nTwice,${phone()}\n`);
    const key = newId();
    const once = (idempotencyKey?: string) =>
      asPrincipal(gm, (context) =>
        runCommand(
          createImportJob,
          { context, audit, outbox, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) },
          input,
        ),
      );
    const first = await once(key);
    expect((await once(key)).id).toBe(first.id);
    await expect(once()).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'import_file_duplicate' },
    });
  });

  it('maps from a new mapping, saves it as a template, and maps another job from it', async () => {
    const first = await run(
      gm,
      createImportJob,
      await fileInput(1, `Name,Mobile,Village\nA,${phone()},X\n`),
    );
    const name = `Fair sheet ${newId().slice(-8)}`;
    const mapped = await run(gm, mapImportJob, {
      entityId: 1,
      jobId: first.id,
      mapping,
      saveAsTemplate: { name },
    });
    expect(mapped.state).toBe('mapped');
    expect(mapped.templateId).not.toBeNull();

    const second = await run(
      gm,
      createImportJob,
      await fileInput(1, `Name,Mobile,Village\nB,${phone()},Y\n`),
    );
    const fromTemplate = await run(gm, mapImportJob, {
      entityId: 1,
      jobId: second.id,
      templateId: mapped.templateId,
    });
    expect(fromTemplate.mapping).toEqual(mapped.mapping);

    await expect(
      run(gm, mapImportJob, { entityId: 1, jobId: second.id, mapping, saveAsTemplate: { name } }),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'import_template_name_taken' },
    });
    // Another entity's General Manager cannot use the template.
    const theirs = await run(
      gm2,
      createImportJob,
      await fileInput(2, `Name,Mobile,Village\nC,${phone()},Z\n`),
    );
    await expect(
      run(gm2, mapImportJob, { entityId: 2, jobId: theirs.id, templateId: mapped.templateId }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'import_template_missing' } });
  });

  it('refuses a mapping that names a column the file lacks', async () => {
    const job = await run(gm, createImportJob, await fileInput(1, `Name,Phone\nA,${phone()}\n`));
    await expect(
      run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'import_mapping_column_missing' },
    });
  });

  it('validates every row, skips repeats in the file and suggests existing customers', async () => {
    const known = phone();
    const existing = await run(gm, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Known customer', phone: known },
      account: { type: 'farm' },
    });
    const repeated = phone();
    const job = await previewedJob(gm, [
      `Asha,${repeated},Sikar`,
      `,${phone()},Churu`,
      `Bad phone,12345,`,
      `Asha again,${repeated},Sikar`,
      `Known,${known},Jhunjhunu`,
    ]);
    expect(job).toMatchObject({ state: 'previewed', validRows: 2, invalidRows: 2, skippedRows: 1 });

    const rows = await rowsOf(gm, job.id);
    expect(rows.map((r) => r.state)).toEqual(['valid', 'invalid', 'invalid', 'skipped', 'valid']);
    expect(rows[1]?.errors).toEqual([{ field: 'contactName', code: 'required' }]);
    expect(rows[2]?.errors).toEqual([{ field: 'phone', code: 'phone_invalid' }]);
    expect(rows[3]?.dedupe).toEqual({ inFileRowNo: 1, existing: [] });
    expect(rows[4]?.dedupe).toEqual({
      inFileRowNo: null,
      existing: [{ accountId: existing.account.id, contactId: existing.contact?.id }],
    });
  });

  it('refuses a preview before a mapping, and a commit before a preview', async () => {
    const job = await run(
      gm,
      createImportJob,
      await fileInput(1, `Name,Mobile,Village\nA,${phone()},X\n`),
    );
    await expect(run(gm, previewImportJob, { entityId: 1, jobId: job.id })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'import_job_state' },
    });
    await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping });
    await expect(run(gm, commitImportJob, { entityId: 1, jobId: job.id })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'import_job_state' },
    });
  });
});

describe('imports: commit and rollback', () => {
  it('commits in batches through crm.lead.create, each row with its own key, and finishes', async () => {
    const names = ['Batch one', 'Batch two', 'Batch three', 'Batch four', 'Batch five'];
    const job = await previewedJob(
      gm,
      names.map((n) => `${n},${phone()},Sikar`),
    );
    const committing = await run(gm, commitImportJob, { entityId: 1, jobId: job.id });
    expect(committing.state).toBe('committing');
    // Asking again while it commits changes nothing.
    expect((await run(gm, commitImportJob, { entityId: 1, jobId: job.id })).state).toBe(
      'committing',
    );

    const first = await run(gm, commitImportBatch, { entityId: 1, jobId: job.id, batchSize: 2 });
    expect(first).toMatchObject({ state: 'committing', committedRows: 2 });
    // One audit row for the batch, with its range and counts; none per lead (design §8).
    const requestId = newId();
    const committed: string[] = [];
    await executeCommand(
      gm,
      { entityIds: [1], requestId },
      commitImportBatch,
      { entityId: 1, jobId: job.id, batchSize: 2 },
      {
        onCommitted: (events) => {
          committed.push(...events.map((e) => e.type));
        },
      },
    );
    const batchAudit = await asMigrator(
      (m) => m<{ command: string; aggregate_id: string; after_json: Record<string, unknown> }[]>`
        select command, aggregate_id, after_json from audit_logs where request_id = ${requestId}`,
    );
    expect(batchAudit).toEqual([
      {
        command: 'imports.job.commit_batch',
        aggregate_id: job.id,
        after_json: {
          state: 'committing',
          batch: 2,
          fromRow: 3,
          toRow: 4,
          rows: 2,
          committedRows: 4,
        },
      },
    ]);
    // Each lead is still made as one typed in, with its own event after the commit.
    expect(committed).toEqual(['crm.lead.created', 'crm.lead.created']);
    const done = await run(gm, commitImportBatch, { entityId: 1, jobId: job.id, batchSize: 2 });
    expect(done).toMatchObject({ state: 'committed', committedRows: 5 });
    // Nothing more to do once committed.
    expect((await run(gm, commitImportBatch, { entityId: 1, jobId: job.id })).state).toBe(
      'committed',
    );

    const rows = await rowsOf(gm, job.id);
    expect(rows.map((r) => [r.state, r.committedBatch, r.createdType])).toEqual([
      ['committed', 1, 'opportunity'],
      ['committed', 1, 'opportunity'],
      ['committed', 2, 'opportunity'],
      ['committed', 2, 'opportunity'],
      ['committed', 3, 'opportunity'],
    ]);
    const ids = rows.map((r) => r.createdId ?? '');
    expect(await liveLeadCount(ids)).toBe(5);

    const keys = await asMigrator(
      (m) => m<{ key: string }[]>`select key from idempotency_keys
        where principal_id = ${gm.id} and command = 'crm.lead.create' and key = any(${[1, 2, 3, 4, 5].map((n) => importRowKey(job.id, n))})`,
    );
    expect(keys).toHaveLength(5);

    const events = await asOutboxPublisher(
      (p) => p<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from outbox_events where aggregate_id = ${job.id} order by sequence`,
    );
    expect(events).toEqual([
      {
        type: 'imports.job.committed',
        payload_json: { kind: 'leads', committedRows: 5, batches: 3, v: 1 },
      },
    ]);
  });

  it('rolls a failed batch back whole and stops the job there', async () => {
    const job = await previewedJob(
      gm,
      ['Fail one', 'Fail two', 'Fail three', 'Fail four', 'Fail five'].map(
        (n) => `${n},${phone()},Churu`,
      ),
    );
    // Row 5 turns bad after the preview, as a pipeline switched off in between would.
    await asMigrator(
      (
        m,
      ) => m`update import_rows set normalised_json = jsonb_set(normalised_json, '{pipelineKey}', '"retired_pipeline"')
                where job_id = ${job.id} and row_no = 5`,
    );
    await run(gm, commitImportJob, { entityId: 1, jobId: job.id });
    const first = await run(gm, commitImportBatch, { entityId: 1, jobId: job.id, batchSize: 3 });
    expect(first).toMatchObject({ state: 'committing', committedRows: 3 });
    const requestId = newId();
    const reported: string[] = [];
    const second = await executeCommand(
      gm,
      { entityIds: [1], requestId },
      commitImportBatch,
      { entityId: 1, jobId: job.id, batchSize: 3 },
      {
        onCommitted: (events) => {
          reported.push(...events.map((e) => e.type));
        },
      },
    );
    expect(second).toMatchObject({ state: 'failed', failedBatch: 2, committedRows: 3 });
    // Row 4's lead went with the savepoint, and so did its event and any audit row.
    expect(reported).toEqual(['imports.job.failed']);
    const failedAudit = await asMigrator(
      (m) =>
        m<{ command: string }[]>`select command from audit_logs where request_id = ${requestId}`,
    );
    expect(failedAudit).toEqual([{ command: 'imports.job.commit_batch' }]);

    const rows = await rowsOf(gm, job.id);
    expect(rows.map((r) => r.state)).toEqual([
      'committed',
      'committed',
      'committed',
      'valid',
      'valid',
    ]);
    // Row 4 was created before row 5 failed; the savepoint took it back with the batch.
    expect(rows[3]?.createdId).toBeNull();
    const [row4] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from contacts where name = 'Fail four'
               and created_by = ${gm.id} and created_at > now() - interval '1 minute'`,
    );
    expect(row4?.n).toBe(0);
    const [key4] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from idempotency_keys
               where principal_id = ${gm.id} and key = ${importRowKey(job.id, 4)}`,
    );
    expect(key4?.n).toBe(0);
    expect(rows[4]?.errors).toEqual([{ field: 'row', code: 'commit_failed' }]);

    // A failed job does not carry on; it can only be rolled back.
    expect((await run(gm, commitImportBatch, { entityId: 1, jobId: job.id })).state).toBe('failed');
    await expect(run(gm, commitImportJob, { entityId: 1, jobId: job.id })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('rolls back newest first, archiving every lead the job created', async () => {
    const job = await previewedJob(
      gm,
      ['Undo one', 'Undo two', 'Undo three'].map((n) => `${n},${phone()},Nagaur`),
    );
    await run(gm, commitImportJob, { entityId: 1, jobId: job.id });
    await run(gm, commitImportBatch, { entityId: 1, jobId: job.id });
    const ids = (await rowsOf(gm, job.id)).map((r) => r.createdId ?? '');
    expect(await liveLeadCount(ids)).toBe(3);

    const requestId = newId();
    const rolled = await executeCommand(gm, { entityIds: [1], requestId }, rollbackImportJob, {
      entityId: 1,
      jobId: job.id,
    });
    expect(rolled.state).toBe('rolled_back');
    expect(await liveLeadCount(ids)).toBe(0);
    expect((await rowsOf(gm, job.id)).map((r) => r.state)).toEqual([
      'rolled_back',
      'rolled_back',
      'rolled_back',
    ]);
    const [row] = await asMigrator(
      (m) => m<{ after_json: Record<string, unknown> }[]>`
        select after_json from audit_logs where request_id = ${requestId} and command = 'imports.job.rollback'`,
    );
    expect(row?.after_json).toMatchObject({
      state: 'rolled_back',
      rolledBackRows: 3,
      archived: 3,
      batches: [{ fromRow: 3, toRow: 1, rows: 3 }],
    });
    await expect(run(gm, rollbackImportJob, { entityId: 1, jobId: job.id })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'import_job_state' },
    });
  });

  it('lets an Executive working across companies commit and roll back an entity’s job', async () => {
    const job = await previewedJob(executive, [`Exec import,${phone()},Pali`], 2);
    await run(executive, commitImportJob, { entityId: 2, jobId: job.id });
    const done = await run(executive, commitImportBatch, { entityId: 2, jobId: job.id });
    expect(done.state).toBe('committed');
    expect((await run(executive, rollbackImportJob, { entityId: 2, jobId: job.id })).state).toBe(
      'rolled_back',
    );
  });
});
