import { FILE_PURPOSES, newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { beginUpload } from '../../src/commands/files/begin-upload';
import { markFileReady, markFileScanned, rejectFile } from '../../src/commands/files/check-file';
import { completeUpload } from '../../src/commands/files/complete-upload';
import { recheckFiles } from '../../src/commands/files/recheck-files';
import { filePurposeGrant } from '../../src/files/purposes';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  countFilesAwaitingChecks,
  getFile,
  getStoredFile,
  listCompanyFiles,
} from '../../src/queries/files/file-queries';

afterAll(closeDb);

const SHA = 'a'.repeat(64);
const WORKER_GRANTS = [{ key: 'files.process' as const, scope: 'all' as const }];

let executive: Principal;
let worker: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive', [1, 2]);
  worker = await createTestPrincipal('executive', [1, 2], { permissions: WORKER_GRANTS });
});

function logo(overrides: Record<string, unknown> = {}) {
  return {
    entityId: 1,
    purpose: 'entity_logo',
    name: 'Shakti Supreme logo.png',
    contentType: 'image/png',
    size: 2048,
    sha256: SHA,
    bucket: 'local',
    ...overrides,
  };
}

const run = (principal: Principal, command: Parameters<typeof runCommand>[0], input: unknown) =>
  asPrincipal(principal, (context) => runCommand(command, { context, audit, outbox }, input));

async function begin(principal: Principal = executive, input: Record<string, unknown> = {}) {
  return asPrincipal(principal, (context) =>
    runCommand(beginUpload, { context, audit, outbox }, logo(input)),
  );
}

async function status(fileId: string): Promise<string | undefined> {
  const [row] = await asMigrator(
    (m) => m<{ status: string }[]>`select status from files where id = ${fileId}`,
  );
  return row?.status;
}

async function auditRows(fileId: string) {
  return asMigrator(
    (m) => m<{ command: string; outcome: string; after: Record<string, unknown> | null }[]>`
      select command, outcome, after_json as after from audit_logs
       where aggregate_id = ${fileId} order by created_at, id`,
  );
}

describe('the purposes in the database and in the domain agree', () => {
  it.each(FILE_PURPOSES)('%s', async (purpose) => {
    const [row] = await asMigrator(
      (m) => m<{ write: string | null; read: string | null }[]>`
        select app.file_purpose_grant(${purpose}, 'write') as write,
               app.file_purpose_grant(${purpose}, 'read') as read`,
    );
    expect(row).toEqual({
      write: filePurposeGrant(purpose, 'write'),
      read: filePurposeGrant(purpose, 'read'),
    });
  });
});

describe('files.upload.begin', () => {
  it('is denied to a role without the purpose’s permission', async () => {
    const caller = principalFor('tele_caller_cc', [1]);
    await expect(begin(caller)).rejects.toMatchObject({ code: 'forbidden' });
    const gm = principalFor('general_manager', [1]);
    await expect(begin(gm)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is refused for a company outside the request', async () => {
    const executiveOfOne = await createTestPrincipal('executive', [1]);
    await expect(begin(executiveOfOne, { entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('never opens a purpose no request may upload', async () => {
    await expect(
      begin(executive, { purpose: 'knowledge', contentType: 'application/pdf' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('takes an import file only as a spreadsheet, and a spreadsheet only as an import file', async () => {
    // Import files come by this upload too (docs/03-roadmap-appendix/phase1.md §6.3), as a CSV or a workbook.
    const imported = await begin(executive, {
      purpose: 'import',
      name: 'leads.csv',
      contentType: 'text/csv',
    });
    expect(imported.entityId).toBe(1);
    expect(imported.key).toMatch(/^1\/import\/[0-9a-f-]+\.csv$/);
    await expect(
      begin(executive, { purpose: 'import', contentType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      begin(executive, { purpose: 'entity_logo', contentType: 'text/csv' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('holds the upload to its purpose’s type and size', async () => {
    await expect(begin(executive, { contentType: 'application/pdf' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'file_type_not_allowed' },
    });
    await expect(begin(executive, { size: 2 * 1024 * 1024 + 1 })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'file_too_large' },
    });
  });

  it('records the upload as pending under a key it makes, and audits it without the name', async () => {
    const slot = await begin();
    expect(slot).toEqual({
      fileId: expect.any(String) as unknown,
      entityId: 1,
      key: `1/entity_logo/${slot.fileId}.png`,
      contentType: 'image/png',
      size: 2048,
      sha256: SHA,
    });
    expect(await status(slot.fileId)).toBe('pending');
    const [row] = await auditRows(slot.fileId);
    expect(row).toMatchObject({
      command: 'files.upload.begin',
      outcome: 'ok',
      after: {
        fileStatus: 'pending',
        purpose: 'entity_logo',
        contentType: 'image/png',
        size: 2048,
      },
    });
    expect(JSON.stringify(row)).not.toContain('Shakti Supreme logo');
  });

  it('acts once for a repeated idempotency key', async () => {
    const key = newId();
    const call = () =>
      executeCommand(executive, { entityIds: [1] }, beginUpload, logo(), { idempotencyKey: key });
    const first = await call();
    const second = await call();
    expect(second).toEqual(first);
  });
});

describe('files.upload.complete', () => {
  const complete = (
    principal: Principal,
    fileId: string,
    stored: object,
    purpose = 'entity_logo',
  ) => run(principal, completeUpload, { fileId, purpose, stored });

  it('starts the checks when the stored object is the one declared, and says so to the worker', async () => {
    const slot = await begin();
    const file = await complete(executive, slot.fileId, { size: 2048, sha256: SHA });
    expect(file).toMatchObject({ id: slot.fileId, status: 'scanning', rejectReason: null });
    const events = await asOutboxPublisher(
      (p) => p<{ type: string; entity_id: number; payload_json: unknown }[]>`
        select type, entity_id, payload_json from outbox_events where aggregate_id = ${slot.fileId}`,
    );
    expect(events).toEqual([
      { type: 'files.file.uploaded', entity_id: 1, payload_json: { purpose: 'entity_logo', v: 1 } },
    ]);
  });

  it('refuses an object of another size or checksum, or none at all', async () => {
    const slot = await begin();
    for (const stored of [
      { size: 2047, sha256: SHA },
      { size: 2048, sha256: 'b'.repeat(64) },
      { size: 0, sha256: null },
    ]) {
      await expect(complete(executive, slot.fileId, stored)).rejects.toMatchObject({
        code: 'conflict',
        details: { reason: 'file_upload_mismatch' },
      });
    }
    expect(await status(slot.fileId)).toBe('pending');
  });

  it('is refused to anyone but the uploader, and for another purpose', async () => {
    const slot = await begin();
    const other = await createTestPrincipal('executive', [1]);
    await expect(complete(other, slot.fileId, { size: 2048, sha256: SHA })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      complete(executive, slot.fileId, { size: 2048, sha256: SHA }, 'letterhead'),
    ).rejects.toMatchObject({ code: 'not_found' });
    const caller = principalFor('tele_caller_cc', [1], { id: executive.id });
    await expect(complete(caller, slot.fileId, { size: 2048, sha256: SHA })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('is refused for a file in a company outside the request', async () => {
    const slot = await begin(executive, { entityId: 2 });
    const onlyOne = { ...executive, entityIds: [1] };
    await expect(complete(onlyOne, slot.fileId, { size: 2048, sha256: SHA })).rejects.toMatchObject(
      { code: 'not_found' },
    );
  });

  it('happens once: a second call is an illegal move', async () => {
    const slot = await begin();
    await complete(executive, slot.fileId, { size: 2048, sha256: SHA });
    await expect(
      complete(executive, slot.fileId, { size: 2048, sha256: SHA }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the file checks', () => {
  async function scanning(entityId = 1): Promise<string> {
    const slot = await begin(executive, { entityId });
    await run(executive, completeUpload, {
      fileId: slot.fileId,
      purpose: 'entity_logo',
      stored: { size: 2048, sha256: SHA },
    });
    return slot.fileId;
  }

  it('are refused to a person, even an Executive', async () => {
    const fileId = await scanning();
    await expect(
      run(executive, markFileScanned, { entityId: 1, fileId, verdict: 'no_threats_found' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(executive, rejectFile, { entityId: 1, fileId, reason: 'file_infected' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('are refused for a company outside the request, and for a file of another company', async () => {
    const fileId = await scanning(2);
    const workerOfOne = { ...worker, entityIds: [1] };
    await expect(
      run(workerOfOne, markFileScanned, { entityId: 2, fileId, verdict: 'no_threats_found' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(worker, markFileScanned, { entityId: 1, fileId, verdict: 'no_threats_found' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('take a clean file to ready with its checked copy, and audit each step', async () => {
    const fileId = await scanning();
    await run(worker, markFileScanned, { entityId: 1, fileId, verdict: 'no_threats_found' });
    expect(await status(fileId)).toBe('scanned');
    const ready = await run(worker, markFileReady, {
      entityId: 1,
      fileId,
      sanitising: 're_encoded',
      stored: {
        key: `1/entity_logo/${fileId}-checked.png`,
        contentType: 'image/png',
        size: 1900,
        sha256: 'e'.repeat(64),
      },
    });
    expect(ready).toMatchObject({ id: fileId, status: 'ready', size: 1900 });
    const stored = await asPrincipal(executive, (ctx) => getStoredFile(ctx, fileId));
    expect(stored).toMatchObject({
      key: `1/entity_logo/${fileId}-checked.png`,
      sha256: 'e'.repeat(64),
    });
    const rows = await auditRows(fileId);
    expect(rows.map((r) => r.command)).toEqual([
      'files.upload.begin',
      'files.upload.complete',
      'files.file.mark_scanned',
      'files.file.mark_ready',
    ]);
    expect(rows[3]?.after).toMatchObject({ fileStatus: 'ready', sanitising: 're_encoded' });
  });

  it('record a file no scanner looked at only where nothing is hosted', async () => {
    const fileId = await scanning();
    const input = { entityId: 1, fileId, verdict: 'not_scanned' };
    // Left unsaid, the runtime is taken to be hosted.
    await expect(run(worker, markFileScanned, input)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'file_not_scanned' },
    });
    await expect(
      asPrincipal(worker, (context) =>
        runCommand(markFileScanned, { context, audit, outbox, hosted: true }, input),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await asPrincipal(worker, (context) =>
      runCommand(markFileScanned, { context, audit, outbox, hosted: false }, input),
    );
    expect(await status(fileId)).toBe('not_scanned');
  });

  it('refuse a file with the reason the uploader is shown', async () => {
    const fileId = await scanning();
    const refused = await run(worker, rejectFile, {
      entityId: 1,
      fileId,
      reason: 'file_infected',
      scanStatus: 'THREATS_FOUND',
    });
    expect(refused).toMatchObject({ status: 'rejected', rejectReason: 'file_infected' });
    const seen = await asPrincipal(executive, (ctx) => getFile(ctx, fileId));
    expect(seen?.rejectReason).toBe('file_infected');
  });

  it('allow only the moves of the upload machine', async () => {
    const fileId = await scanning();
    await expect(
      run(worker, markFileReady, {
        entityId: 1,
        fileId,
        sanitising: 'pdf_checked',
        stored: { key: `1/x/${fileId}.pdf`, contentType: 'application/pdf', size: 1, sha256: SHA },
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'file_upload_transition_not_allowed' },
    });
    await run(worker, rejectFile, { entityId: 1, fileId, reason: 'file_unreadable' });
    await expect(
      run(worker, markFileScanned, { entityId: 1, fileId, verdict: 'no_threats_found' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('the company files a screen lists', () => {
  it('names the newest ready logo of each company the caller sees', async () => {
    const entityId = 3;
    const ids = [newId(), newId(), newId()];
    await asMigrator(async (m) => {
      await m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by, created_at)
        values (${ids[0] ?? ''}, ${entityId}, 'entity_logo', 'test', ${`t/${ids[0] ?? ''}`}, 'old.png', 'image/png', 1, ${SHA}, 'ready', ${executive.id}, '2090-01-01'),
               (${ids[1] ?? ''}, ${entityId}, 'entity_logo', 'test', ${`t/${ids[1] ?? ''}`}, 'new.png', 'image/png', 1, ${SHA}, 'ready', ${executive.id}, '2090-02-01'),
               (${ids[2] ?? ''}, ${entityId}, 'entity_logo', 'test', ${`t/${ids[2] ?? ''}`}, 'checking.png', 'image/png', 1, ${SHA}, 'scanning', ${executive.id}, '2090-03-01')`;
    });
    const caller = principalFor('tele_caller_cc', [entityId]);
    const listed = await asPrincipal(caller, (ctx) => listCompanyFiles(ctx, ['entity_logo']));
    expect(listed.filter((f) => f.entityId === entityId).map((f) => f.name)).toEqual(['new.png']);
    const other = principalFor('tele_caller_cc', [4]);
    const seen = await asPrincipal(other, (ctx) => listCompanyFiles(ctx, ['entity_logo']));
    expect(seen.some((f) => f.entityId === entityId)).toBe(false);
  });
});

describe('files.file.recheck', () => {
  it('is denied to anyone but an Executive acting for every company', async () => {
    await expect(run(principalFor('general_manager', [1]), recheckFiles, {})).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
    await expect(run(worker, recheckFiles, {})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('sends every file left waiting back to its checks, and none that is done or just begun', async () => {
    const waiting = await begin();
    await run(executive, completeUpload, {
      fileId: waiting.fileId,
      purpose: 'entity_logo',
      stored: { size: 2048, sha256: SHA },
    });
    const fresh = await begin();
    await run(executive, completeUpload, {
      fileId: fresh.fileId,
      purpose: 'entity_logo',
      stored: { size: 2048, sha256: SHA },
    });
    const pending = await begin();
    // Only the first has waited more than ten minutes; the triggers that stamp the time are
    // held off for this one write.
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update files set updated_at = now() - interval '11 minutes'
                  where id in ${tx([waiting.fileId, pending.fileId])}`;
      }),
    );
    const counted = await asPrincipal(executive, (ctx) => countFilesAwaitingChecks(ctx));
    expect(counted).toBeGreaterThanOrEqual(1);
    const done = (await run(executive, recheckFiles, {})) as { requeued: number };
    expect(done.requeued).toBeGreaterThanOrEqual(1);
    const events = await asOutboxPublisher(
      (p) => p<{ aggregate_id: string }[]>`
        select aggregate_id from outbox_events
         where type = 'files.file.uploaded'
           and aggregate_id in ${p([waiting.fileId, fresh.fileId, pending.fileId])}`,
    );
    const count = (id: string) => events.filter((e) => e.aggregate_id === id).length;
    // The upload's own event and the one sent again; nothing new for the others.
    expect(count(waiting.fileId)).toBe(2);
    expect(count(fresh.fileId)).toBe(1);
    expect(count(pending.fileId)).toBe(0);
    const rows = await auditRows(waiting.fileId);
    expect(rows.at(-1)).toMatchObject({
      command: 'files.file.recheck',
      outcome: 'ok',
      after: { fileStatus: 'scanning' },
    });
  });
});
