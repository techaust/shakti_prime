// J3 customer documents and requirements (docs/03-roadmap-appendix/phase4.md §6.3, SECURITY §5,
// §11 items 7 and 8): documents.file, .unfile, .view and .requirement.set on real Postgres. Every
// number here is made up, and every customer is this file's own.
import { newId, type DocumentDto, type Principal } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  fileDocument,
  setDocumentRequirement,
  unfileDocument,
  viewDocument,
} from '../../src/commands/documents/documents';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listCustomerDocuments, missingDocuments } from '../../src/queries/documents/documents';

const SHA = 'e'.repeat(64);

let manager: Principal; // Project Manager of company 1
let gm: Principal; // General Manager of company 1
let engineer: Principal; // Field Engineer of company 1
let inventory: Principal; // Inventory Manager of company 1: no documents grant
let executive: Principal;
let account: string; // owned by the engineer in company 1, known to company 2 as well
let otherAccount: string;

function run<T = DocumentDto>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  entityIds: readonly number[] = [1],
): Promise<T> {
  return asPrincipal({ ...principal, entityIds: [...entityIds] }, (context) =>
    runCommand(command, { context, audit, outbox, hosted: false }, input),
  ) as Promise<T>;
}

/** The domain error's code and reason a command failed with. */
async function refusal(
  promise: Promise<unknown>,
): Promise<{ code: string; reason?: string | undefined }> {
  try {
    await promise;
  } catch (e) {
    const error = e as { code?: string; details?: { reason?: string } };
    return { code: error.code ?? 'unknown', reason: error.details?.reason };
  }
  throw new Error('expected the command to fail');
}

/** A customer document of `account` uploaded by `uploadedBy`, as its checks left it. */
async function upload(
  uploadedBy: Principal,
  options: {
    account?: string;
    entityId?: number;
    status?: string;
    scan?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const id = newId();
  const scan = options.scan ?? {
    verdict: 'not_scanned',
    sanitising: 'masked',
    lastFour: { aadhaar: ['0123'], bankAccount: [] },
  };
  await asMigrator(
    (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                sha256, status, scan_result, account_id, created_by)
      values (${id}, ${options.entityId ?? 1}, 'customer_document', 'test',
              ${`1/customer_document/${id}-checked.jpg`}, 'photo XXXX XXXX 0123.jpg', 'image/jpeg',
              10, ${SHA}, ${options.status ?? 'ready'}, ${JSON.stringify(scan)}::jsonb,
              ${options.account ?? account}, ${uploadedBy.id})`,
  );
  return id;
}

beforeAll(async () => {
  manager = await createTestPrincipal('project_manager', [1]);
  gm = await createTestPrincipal('general_manager', [1]);
  engineer = await createTestPrincipal('field_engineer', [1]);
  inventory = await createTestPrincipal('inventory_manager', [1]);
  executive = await createTestPrincipal('executive', [1, 2]);
  account = newId();
  otherAccount = newId();
  await asMigrator(async (m) => {
    await m`insert into accounts (id, type, name, created_by) values
      (${account}, 'household', 'documents command customer', ${engineer.id}),
      (${otherAccount}, 'household', 'documents command other customer', ${engineer.id})`;
    await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by) values
      (${newId()}, ${account}, 1, ${engineer.id}, ${engineer.id}),
      (${newId()}, ${account}, 2, ${engineer.id}, ${engineer.id}),
      (${newId()}, ${otherAccount}, 1, ${gm.id}, ${gm.id})`;
  });
});
afterAll(closeDb);

describe('documents.document.file', () => {
  it('files an identity paper as sensitive and keeps only its last four digits', async () => {
    const file = await upload(manager);
    const filed = await run(manager, fileDocument, {
      entityId: 1,
      accountId: account,
      fileId: file,
      kind: 'identity_proof',
      requirementKey: 'identity_proof',
    });
    expect(filed).toMatchObject({
      accountId: account,
      fileId: file,
      kind: 'identity_proof',
      sensitive: true,
      filedByKind: 'person',
      lastFour: [{ kind: 'aadhaar', lastFour: '0123' }],
    });
    const [kept] = await asMigrator(
      (m) => m<{ kind: string; last4: string; masked_file_id: string }[]>`
        select kind, last4, masked_file_id from identity_documents where document_id = ${filed.id}`,
    );
    expect(kept).toEqual({ kind: 'aadhaar', last4: '0123', masked_file_id: file });
    // The audit row counts the numbers kept; it holds none of their digits.
    const [row] = await asMigrator(
      (m) => m<{ after: Record<string, unknown> }[]>`
        select after_json as after from audit_logs
         where aggregate_id = ${filed.id} and command = 'documents.document.file'`,
    );
    expect(row?.after).toMatchObject({ documentKind: 'identity_proof', identityNumbers: 1 });
    expect(JSON.stringify(row?.after)).not.toContain('0123');
  });

  it('files a bill as an ordinary document, read by the customer’s owner', async () => {
    const file = await upload(engineer);
    const filed = await run(engineer, fileDocument, {
      entityId: 1,
      accountId: account,
      fileId: file,
      kind: 'electricity_bill',
      requirementKey: 'electricity_bill',
    });
    expect(filed).toMatchObject({ sensitive: false, lastFour: [] });
    const listed = await asPrincipal(engineer, (ctx) =>
      listCustomerDocuments(ctx, { entityId: 1, accountId: account }),
    );
    expect(listed.map((d) => d.id)).toContain(filed.id);
    expect(listed.every((d) => !d.sensitive)).toBe(true);
  });

  it('refuses a file uploaded for another customer (SECURITY §11 item 7)', async () => {
    const file = await upload(gm, { account: otherAccount });
    expect(
      await refusal(
        run(gm, fileDocument, {
          entityId: 1,
          accountId: account,
          fileId: file,
          kind: 'electricity_bill',
          requirementKey: 'electricity_bill',
        }),
      ),
    ).toEqual({ code: 'forbidden', reason: 'file_customer_mismatch' });
    const [count] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from documents where file_id = ${file}`,
    );
    expect(count?.n).toBe(0);
  });

  it('refuses a file still being checked, one refused by its checks, an unscanned one where hosted, and an unmasked one', async () => {
    const input = (fileId: string) => ({
      entityId: 1,
      accountId: account,
      fileId,
      kind: 'electricity_bill',
      requirementKey: 'electricity_bill',
    });
    expect(
      await refusal(
        run(manager, fileDocument, input(await upload(manager, { status: 'scanning' }))),
      ),
    ).toEqual({ code: 'conflict', reason: 'document_file_not_ready' });
    expect(
      await refusal(
        run(manager, fileDocument, input(await upload(manager, { status: 'rejected' }))),
      ),
    ).toEqual({ code: 'conflict', reason: 'file_not_clean' });
    const unscanned = await upload(manager);
    expect(
      await refusal(
        asPrincipal(manager, (context) =>
          runCommand(fileDocument, { context, audit, outbox, hosted: true }, input(unscanned)),
        ),
      ),
    ).toEqual({ code: 'conflict', reason: 'file_not_clean' });
    const unmasked = await upload(manager, {
      scan: { verdict: 'no_threats_found', sanitising: 're_encoded' },
    });
    expect(await refusal(run(manager, fileDocument, input(unmasked)))).toEqual({
      code: 'conflict',
      reason: 'file_not_masked',
    });
  });

  it('files a sensitive kind only with documents.sensitive.read', async () => {
    const file = await upload(gm);
    expect(
      await refusal(
        run(gm, fileDocument, {
          entityId: 1,
          accountId: account,
          fileId: file,
          kind: 'bank_proof',
          requirementKey: null,
        }),
      ),
    ).toEqual({ code: 'forbidden', reason: 'document_sensitive_forbidden' });
  });

  it('refuses a kind the requirement does not take, and a file filed twice', async () => {
    const file = await upload(manager);
    expect(
      await refusal(
        run(manager, fileDocument, {
          entityId: 1,
          accountId: account,
          fileId: file,
          kind: 'site_photo',
          requirementKey: 'electricity_bill',
        }),
      ),
    ).toEqual({ code: 'validation_failed', reason: 'document_kind_not_accepted' });
    const input = {
      entityId: 1,
      accountId: account,
      fileId: file,
      kind: 'electricity_bill',
      requirementKey: 'electricity_bill',
    };
    await run(manager, fileDocument, input);
    expect(await refusal(run(manager, fileDocument, input))).toMatchObject({ code: 'conflict' });
  });

  it('is denied without documents.write, to an agent, and in a company outside the request', async () => {
    const file = await upload(manager);
    const input = {
      entityId: 1,
      accountId: account,
      fileId: file,
      kind: 'electricity_bill',
      requirementKey: 'electricity_bill',
    };
    expect(await refusal(run(inventory, fileDocument, input))).toMatchObject({ code: 'forbidden' });
    const concierge = await createTestPrincipal('agent:concierge', [1]);
    expect(await refusal(run(concierge, fileDocument, input))).toMatchObject({ code: 'forbidden' });
    // Acting in company 2, a file of company 1 is outside the request.
    expect(
      await refusal(run(executive, fileDocument, { ...input, entityId: 1 }, [2])),
    ).toMatchObject({ code: 'forbidden' });
    // The file is of company 1: filing it in company 2 finds no such file there.
    expect(
      await refusal(run(executive, fileDocument, { ...input, entityId: 2 }, [2])),
    ).toMatchObject({ code: 'not_found', reason: 'file_missing' });
  });

  it('never reaches another person’s unfiled upload', async () => {
    const file = await upload(engineer);
    expect(
      await refusal(
        run(manager, fileDocument, {
          entityId: 1,
          accountId: account,
          fileId: file,
          kind: 'electricity_bill',
          requirementKey: 'electricity_bill',
        }),
      ),
    ).toEqual({ code: 'not_found', reason: 'file_missing' });
  });
});

describe('documents.document.unfile and documents.document.view', () => {
  it('are denied without the grant, and refused in a company outside the request', async () => {
    const file = await upload(manager);
    const filed = await run(manager, fileDocument, {
      entityId: 1,
      accountId: account,
      fileId: file,
      kind: 'electricity_bill',
      requirementKey: 'electricity_bill',
    });
    const unfile = { entityId: 1, documentId: filed.id, reason: 'Filed against the wrong step' };
    const view = { entityId: 1, documentId: filed.id };
    expect(await refusal(run(inventory, unfileDocument, unfile))).toMatchObject({
      code: 'forbidden',
    });
    expect(await refusal(run(inventory, viewDocument, view))).toMatchObject({ code: 'forbidden' });
    // The Executive acting for company 2 only: company 1 is outside the request.
    expect(await refusal(run(executive, unfileDocument, unfile, [2]))).toMatchObject({
      code: 'forbidden',
    });
    expect(await refusal(run(executive, viewDocument, view, [2]))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('unfiles with a reason, once, and the identity document goes with it', async () => {
    const file = await upload(manager);
    const filed = await run(manager, fileDocument, {
      entityId: 1,
      accountId: account,
      fileId: file,
      kind: 'identity_proof',
      requirementKey: 'identity_proof',
    });
    const unfiled = await run(manager, unfileDocument, {
      entityId: 1,
      documentId: filed.id,
      reason: 'The photo is of another family member',
    });
    expect(unfiled).toMatchObject({ unfiledReason: 'The photo is of another family member' });
    expect(unfiled.unfiledAt).not.toBeNull();
    const [seen] = (await asPrincipal(manager, ({ tx }) =>
      tx.execute(
        sql`select count(*)::int as n from identity_documents where document_id = ${filed.id}`,
      ),
    )) as unknown as { n: number }[];
    expect(seen?.n).toBe(0);
    expect(
      await refusal(
        run(manager, unfileDocument, { entityId: 1, documentId: filed.id, reason: 'Again' }),
      ),
    ).toEqual({ code: 'conflict', reason: 'document_already_unfiled' });
  });

  it('refuses to unfile or open a sensitive document to someone without documents.sensitive.read', async () => {
    const file = await upload(manager);
    const filed = await run(manager, fileDocument, {
      entityId: 1,
      accountId: account,
      fileId: file,
      kind: 'identity_proof',
      requirementKey: 'identity_proof',
    });
    expect(
      await refusal(
        run(gm, unfileDocument, { entityId: 1, documentId: filed.id, reason: 'Wrong customer' }),
      ),
    ).toEqual({ code: 'not_found', reason: 'document_missing' });
    expect(await refusal(run(gm, viewDocument, { entityId: 1, documentId: filed.id }))).toEqual({
      code: 'not_found',
      reason: 'document_missing',
    });
  });

  it('audits each opening of a sensitive document, and not of an ordinary one', async () => {
    const idFile = await upload(manager);
    const identity = await run(manager, fileDocument, {
      entityId: 1,
      accountId: account,
      fileId: idFile,
      kind: 'identity_proof',
      requirementKey: 'identity_proof',
    });
    const billFile = await upload(manager);
    const bill = await run(manager, fileDocument, {
      entityId: 1,
      accountId: account,
      fileId: billFile,
      kind: 'electricity_bill',
      requirementKey: 'electricity_bill',
    });
    expect(await run(manager, viewDocument, { entityId: 1, documentId: identity.id })).toEqual({
      documentId: identity.id,
      fileId: idFile,
      sensitive: true,
    });
    await run(manager, viewDocument, { entityId: 1, documentId: bill.id });
    const views = await asMigrator(
      (m) => m<{ aggregate_id: string }[]>`
        select aggregate_id from audit_logs
         where command = 'documents.document.view' and aggregate_id in (${identity.id}, ${bill.id})`,
    );
    expect(views.map((v) => v.aggregate_id)).toEqual([identity.id]);
  });
});

describe('documents.requirement.set and the completeness check', () => {
  it('lets only an Executive change a requirement, and the check follows it', async () => {
    const customer = newId();
    await asMigrator(async (m) => {
      await m`insert into accounts (id, type, name, created_by)
        values (${customer}, 'household', 'documents completeness customer', ${manager.id})`;
      await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
        values (${newId()}, ${customer}, 1, ${manager.id}, ${manager.id})`;
    });
    const input = {
      entityId: 1,
      flow: 'standard',
      stepKey: 'dispatch',
      requirementKey: 'agreement',
      mandatory: true,
      acceptedKinds: ['agreement'],
      position: 1,
      active: true,
    };
    expect(await refusal(run(gm, setDocumentRequirement, input))).toMatchObject({
      code: 'forbidden',
    });
    const set = await run(executive, setDocumentRequirement, input);
    expect(set).toMatchObject({
      stepKey: 'dispatch',
      requirementKey: 'agreement',
      mandatory: true,
    });
    const missing = () =>
      asPrincipal(manager, ({ tx }) =>
        missingDocuments(tx, {
          entityId: 1,
          accountId: customer,
          projectId: null,
          flow: 'standard',
          stepKey: 'dispatch',
        }),
      );
    expect(await missing()).toEqual(['agreement']);
    await run(executive, setDocumentRequirement, { ...input, active: false });
    expect(await missing()).toEqual([]);
    // Back on for the next run of the suites, which shares the database.
    await run(executive, setDocumentRequirement, { ...input, mandatory: false });
  });

  it('is refused in a company outside the request', async () => {
    expect(
      await refusal(
        run(
          executive,
          setDocumentRequirement,
          {
            entityId: 1,
            flow: 'standard',
            stepKey: 'survey',
            requirementKey: 'electricity_bill',
            mandatory: true,
            acceptedKinds: ['electricity_bill'],
            position: 1,
            active: true,
          },
          [2],
        ),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('refuses a step that is not of the flow', async () => {
    expect(
      await refusal(
        run(executive, setDocumentRequirement, {
          entityId: 1,
          flow: 'standard',
          stepKey: 'net_metering',
          requirementKey: 'net_meter_certificate',
          mandatory: true,
          acceptedKinds: ['net_meter_certificate'],
          position: 1,
          active: true,
        }),
      ),
    ).toMatchObject({ code: 'validation_failed' });
  });
});
