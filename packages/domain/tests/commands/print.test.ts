import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { recordRenderedFile } from '../../src/commands/files/record-rendered';
import { retireRenderedFiles } from '../../src/commands/files/retire-rendered';
import { requestPrintProof } from '../../src/commands/print/request-proof';
import { uploadKey } from '../../src/files/limits';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import { getFile } from '../../src/queries/files/file-queries';

afterAll(closeDb);

const SHA = 'b'.repeat(64);

let executive: Principal;
let worker: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive', [1, 2]);
  // The seeded worker principal, whose row stamps the files it records.
  worker = principalFor('system:workers', [1], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
});

function rendered(fileId = newId(), overrides: Record<string, unknown> = {}) {
  return {
    entityId: 1,
    fileId,
    purpose: 'print_proof',
    bucket: 'local',
    key: uploadKey(1, 'print_proof', fileId, 'application/pdf'),
    name: 'Proof page of Shakti Supreme.pdf',
    size: 2048,
    sha256: SHA,
    ...overrides,
  };
}

const run = (principal: Principal, command: Parameters<typeof runCommand>[0], input: unknown) =>
  asPrincipal(principal, (context) => runCommand(command, { context, audit, outbox }, input));

describe('print.proof.request (docs/03-roadmap-appendix/phase1.md §6.4)', () => {
  it('is refused to a General Manager, an agent and the worker principal', async () => {
    for (const role of [
      'general_manager',
      'store_manager',
      'agent:triage',
      'system:workers',
    ] as const) {
      await expect(
        run(principalFor(role, [1]), requestPrintProof, { entityId: 1 }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuses a company outside the request', async () => {
    const one = await createTestPrincipal('executive', [1]);
    await expect(run(one, requestPrintProof, { entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('asks the render worker for the company’s proof page, with ids and codes only', async () => {
    const emitted = memoryOutboxSink();
    const proof = await asPrincipal(executive, (context) =>
      runCommand(requestPrintProof, { context, audit, outbox: emitted }, { entityId: 2 }),
    );
    expect(proof).toMatchObject({ entityId: 2 });
    expect(emitted.records).toEqual([
      {
        type: 'print.document.requested',
        entityId: 2,
        aggregateType: 'print_proof',
        aggregateId: proof.proofId,
        payload: {
          documentType: 'company_letterhead_proof',
          documentId: proof.proofId,
          version: 1,
          v: 1,
        },
      },
    ]);
    const rows = await asMigrator(
      (m) => m<{ after: unknown; entity: number }[]>`
        select after_json as after, entity_id as entity from audit_logs
         where command = 'print.proof.request' and aggregate_id = ${proof.proofId}`,
    );
    expect(rows).toEqual([{ after: { documentType: 'company_letterhead_proof' }, entity: 2 }]);
  });
});

describe('files.document.record (ADR 0009)', () => {
  it('is refused to anyone without files.process: a person, an Executive, an agent', async () => {
    for (const principal of [
      executive,
      principalFor('general_manager', [1]),
      principalFor('agent:triage', [1]),
      principalFor('agent:chief', [1]),
    ]) {
      await expect(run(principal, recordRenderedFile, rendered())).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('refuses a company outside the worker’s request', async () => {
    const fileId = newId();
    await expect(
      run(worker, recordRenderedFile, {
        ...rendered(fileId),
        entityId: 2,
        key: uploadKey(2, 'print_proof', fileId, 'application/pdf'),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a key that is not the file’s own and a purpose no worker renders', async () => {
    await expect(
      run(worker, recordRenderedFile, rendered(newId(), { key: '1/print_proof/other.pdf' })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'file_upload_mismatch' },
    });
    await expect(
      run(worker, recordRenderedFile, rendered(newId(), { purpose: 'entity_logo' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('records the PDF ready, once, readable by an Executive and not by a General Manager', async () => {
    const fileId = newId();
    const first = await run(worker, recordRenderedFile, rendered(fileId));
    expect(first).toMatchObject({
      id: fileId,
      entityId: 1,
      purpose: 'print_proof',
      contentType: 'application/pdf',
      status: 'ready',
      size: 2048,
    });
    // A delivery that runs again finds the same file and changes nothing.
    expect(await run(worker, recordRenderedFile, rendered(fileId))).toEqual(first);
    const [stored] = await asMigrator(
      (m) => m<{ n: number; scan: unknown; by: string }[]>`
        select count(*)::int as n, max(scan_result::text)::jsonb as scan,
               max(created_by::text) as by
          from files where id = ${fileId}`,
    );
    expect(stored).toEqual({
      n: 1,
      scan: { scanner: 'none', sanitising: 'rendered' },
      by: worker.id,
    });
    const audited = await asMigrator(
      (m) => m<{ after: unknown }[]>`
        select after_json as after from audit_logs
         where command = 'files.document.record' and aggregate_id = ${fileId}`,
    );
    expect(audited).toEqual([
      {
        after: {
          fileStatus: 'ready',
          purpose: 'print_proof',
          contentType: 'application/pdf',
          size: 2048,
        },
      },
    ]);

    const exec = await createTestPrincipal('executive', [1]);
    expect(await asPrincipal(exec, (ctx) => getFile(ctx, fileId))).toMatchObject({ id: fileId });
    for (const role of [
      'general_manager',
      'sales_team_lead',
      'accounts',
      'agent:triage',
    ] as const) {
      expect(
        await asPrincipal(principalFor(role, [1]), (ctx) => getFile(ctx, fileId)),
      ).toBeUndefined();
    }
  });

  it('refuses an id already used by another file', async () => {
    const fileId = newId();
    await run(worker, recordRenderedFile, rendered(fileId));
    await expect(
      run(worker, recordRenderedFile, rendered(fileId, { size: 4096 })),
    ).resolves.toMatchObject({ size: 2048 });
    await expect(
      run(worker, recordRenderedFile, {
        ...rendered(fileId),
        purpose: 'quote_pdf',
        key: uploadKey(1, 'quote_pdf', fileId, 'application/pdf'),
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'file_upload_mismatch' } });
  });
});

describe('files.document.retire (P4 review L10)', () => {
  const retire = (keepFileId: string, entityId = 1) => ({
    entityId,
    purpose: 'print_proof',
    keepFileId,
  });

  it('is refused to anyone without files.process: a person, an Executive, an agent', async () => {
    const kept = newId();
    await run(worker, recordRenderedFile, rendered(kept));
    for (const principal of [
      executive,
      principalFor('general_manager', [1]),
      principalFor('agent:triage', [1]),
    ]) {
      await expect(run(principal, retireRenderedFiles, retire(kept))).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('refuses a company outside the worker’s request, and a kept file that is not a ready proof', async () => {
    const kept = newId();
    await run(worker, recordRenderedFile, rendered(kept));
    await expect(run(worker, retireRenderedFiles, retire(kept, 2))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(worker, retireRenderedFiles, retire(newId()))).rejects.toMatchObject({
      code: 'not_found',
    });
    const quote = newId();
    await run(worker, recordRenderedFile, {
      ...rendered(quote),
      purpose: 'quote_pdf',
      key: uploadKey(1, 'quote_pdf', quote, 'application/pdf'),
    });
    await expect(run(worker, retireRenderedFiles, retire(quote))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      run(worker, retireRenderedFiles, { ...retire(kept), purpose: 'quote_pdf' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('retires the company’s earlier proof pages only, once, and names their keys', async () => {
    const [first, second, third] = [newId(), newId(), newId()];
    const quote = newId();
    for (const id of [first, second, third]) await run(worker, recordRenderedFile, rendered(id));
    await run(worker, recordRenderedFile, {
      ...rendered(quote),
      purpose: 'quote_pdf',
      key: uploadKey(1, 'quote_pdf', quote, 'application/pdf'),
    });
    const key = (id: string) => uploadKey(1, 'print_proof', id, 'application/pdf');

    // A late delivery of the second page retires the first and leaves the newer third alone.
    const late = await run(worker, retireRenderedFiles, retire(second));
    expect(late.keys).toContain(key(first));
    expect(late.keys).not.toContain(key(second));
    expect(late.keys).not.toContain(key(third));

    const latest = await run(worker, retireRenderedFiles, retire(third));
    expect(latest).toEqual({ retired: 1, keys: [key(second)] });
    expect(await run(worker, retireRenderedFiles, retire(third))).toEqual({ retired: 0, keys: [] });

    const rows = await asMigrator(
      (m) => m<{ id: string; status: string; scan: unknown }[]>`
        select id, status, scan_result as scan from files
         where id in ${m([first, second, third, quote])}`,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of [first, second]) {
      expect(byId.get(id)).toMatchObject({
        status: 'rejected',
        scan: { rejectReason: 'file_replaced' },
      });
    }
    expect(byId.get(third)?.status).toBe('ready');
    expect(byId.get(quote)?.status).toBe('ready');

    const audited = await asMigrator(
      (m) => m<{ before: unknown; after: unknown }[]>`
        select before_json as before, after_json as after from audit_logs
         where command = 'files.document.retire' and aggregate_id = ${second}`,
    );
    expect(audited).toEqual([
      {
        before: { fileStatus: 'ready' },
        after: { fileStatus: 'rejected', rejectReason: 'file_replaced' },
      },
    ]);
  });
});
