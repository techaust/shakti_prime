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

describe('print.proof.request (docs/design/phase1.md §6.4)', () => {
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
