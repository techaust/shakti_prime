import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { recordConsent, withdrawConsent } from '../../src/commands/crm/consent';
import { createLead } from '../../src/commands/crm/create-lead';
import { beginUpload } from '../../src/commands/files/begin-upload';
import { loadAccount360 } from '../../src/queries/crm/customers';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// crm.consent.record and crm.consent.withdraw (CRM-10): consent per channel and purpose with its
// source, text version and time; a withdrawal stands, and the evidence is fixed once written.

afterAll(closeDb);

let caller: Principal;
let colleague: Principal;
let teamLead: Principal;

beforeAll(async () => {
  const teamId = await createTestTeam(1, 'consent team');
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  colleague = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  teamLead = await createTestPrincipal('sales_team_lead', [1], { teamId });
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const phone = (): string => `93${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const reason = (r: string) => ({ details: { reason: r } });

async function customerOf(owner: Principal) {
  const lead = (await run(owner, createLead, {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Consent customer', phone: phone() },
    account: { type: 'farm' },
  })) as { account: { id: string }; contact: { id: string } };
  return { accountId: lead.account.id, contactId: lead.contact.id };
}

const consentOf = (k: { accountId: string; contactId: string }, extra: object = {}) => ({
  entityId: 1,
  ...k,
  channel: 'whatsapp',
  purpose: 'promotional',
  source: 'walk_in_form',
  textVersion: 'v2',
  givenAt: new Date(Date.now() - 3_600_000).toISOString(),
  ...extra,
});

describe('crm.consent.record', () => {
  it('records a consent with its evidence and writes the timeline row', async () => {
    const k = await customerOf(caller);
    const made = (await run(caller, recordConsent, consentOf(k))) as {
      id: string;
      withdrawnAt: string | null;
      hasEvidence: boolean;
      evidenceFileId: string | null;
    };
    expect(made).toMatchObject({ withdrawnAt: null, hasEvidence: false, evidenceFileId: null });
    const [row] = await asMigrator(
      (m) => m<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from activities where account_id = ${k.accountId}
           and type = 'consent_recorded'`,
    );
    expect(row?.payload_json).toEqual({
      consentId: made.id,
      channel: 'whatsapp',
      purpose: 'promotional',
      source: 'walk_in_form',
    });
  });

  it('takes a version code, such as a date, and refuses any other text as the version', async () => {
    const k = await customerOf(caller);
    await expect(
      run(caller, recordConsent, consentOf(k, { textVersion: '2026-09-30' })),
    ).resolves.toMatchObject({ textVersion: '2026-09-30' });
    const refused = run(caller, recordConsent, consentOf(k, { textVersion: 'Form @ shop, 2' }));
    await expect(refused).rejects.toMatchObject({
      code: 'validation_failed',
      details: { issues: [{ path: 'textVersion', message: 'consent_version_invalid' }] },
    });
  });

  it('refuses a consent given in the future', async () => {
    const k = await customerOf(caller);
    await expect(
      run(
        caller,
        recordConsent,
        consentOf(k, { givenAt: new Date(Date.now() + 3_600_000).toISOString() }),
      ),
    ).rejects.toMatchObject(reason('consent_given_in_future'));
  });

  it('is refused without crm.account.write, for another customer, and in another company', async () => {
    const k = await customerOf(caller);
    const other = await customerOf(caller);
    const accounts = await createTestPrincipal('accounts', [1]);
    await expect(run(accounts, recordConsent, consentOf(k))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run(caller, recordConsent, consentOf({ accountId: k.accountId, contactId: other.contactId })),
    ).rejects.toMatchObject(reason('contact_missing'));
    await expect(run(colleague, recordConsent, consentOf(k))).rejects.toMatchObject(
      reason('contact_missing'),
    );
    await expect(run(caller, recordConsent, consentOf(k, { entityId: 2 }))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

const SHA = 'c'.repeat(64);

/** A proof file the caller uploads through the upload flow; it is `pending` until its bytes land. */
async function upload(principal: Principal, entityId = 1): Promise<string> {
  const slot = (await run(principal, beginUpload, {
    entityId,
    purpose: 'consent_evidence',
    name: 'Signed consent form.pdf',
    contentType: 'application/pdf',
    size: 4096,
    sha256: SHA,
    bucket: 'local',
  })) as { fileId: string };
  return slot.fileId;
}

/** Where the file checks leave a file (the files.file.uploaded worker in the app). */
async function setStatus(fileId: string, status: string): Promise<void> {
  await asMigrator((m) => m`update files set status = ${status} where id = ${fileId}`);
}

/** A file of any purpose and company, as a test fixture outside the upload flow. */
async function storedFile(entityId: number, purpose: string, createdBy: string): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                sha256, status, created_by)
             values (${id}, ${entityId}, ${purpose}, 'test', ${`t/${id}`}, 'proof.png',
                     'image/png', 1, ${SHA}, 'ready', ${createdBy})`,
  );
  return id;
}

describe('crm.consent.record with proof (CRM-10)', () => {
  it('keeps a checked proof file of the company with the consent', async () => {
    const k = await customerOf(caller);
    const fileId = await upload(caller);
    await setStatus(fileId, 'ready');
    const made = (await run(caller, recordConsent, consentOf(k, { evidenceFileId: fileId }))) as {
      id: string;
      hasEvidence: boolean;
      evidenceFileId: string | null;
    };
    expect(made).toMatchObject({ hasEvidence: true, evidenceFileId: fileId });
    const [row] = await asMigrator(
      (m) => m<{ evidence_file_id: string | null; after: Record<string, unknown> }[]>`
        select c.evidence_file_id, l.after_json as after from consents c
          join audit_logs l on l.aggregate_id = c.id::text and l.command = 'crm.consent.record'
         where c.id = ${made.id}`,
    );
    expect(row).toMatchObject({ evidence_file_id: fileId, after: { evidence: true } });
  });

  it('names the proof on Account 360 only to those who may open it', async () => {
    const k = await customerOf(caller);
    const fileId = await upload(caller);
    await setStatus(fileId, 'ready');
    await run(caller, recordConsent, consentOf(k, { evidenceFileId: fileId }));
    const proofFor = async (principal: Principal) => {
      const view = await asPrincipal(principal, (ctx) =>
        loadAccount360(ctx, { accountId: k.accountId, entityId: 1 }),
      );
      return view.consents.map((c) => ({ has: c.hasEvidence, id: c.evidenceFileId }));
    };
    // The uploader and a company-wide customer writer open it; the team lead, who reads the
    // customer through the lead but opens only proof they uploaded, sees that it is kept.
    expect(await proofFor(caller)).toEqual([{ has: true, id: fileId }]);
    expect(await proofFor(await createTestPrincipal('general_manager', [1]))).toEqual([
      { has: true, id: fileId },
    ]);
    expect(await proofFor(teamLead)).toEqual([{ has: true, id: null }]);
  });

  it('waits for a file still being checked, and refuses one the checks refused', async () => {
    const k = await customerOf(caller);
    const pending = await upload(caller);
    await expect(
      run(caller, recordConsent, consentOf(k, { evidenceFileId: pending })),
    ).rejects.toMatchObject({ code: 'conflict', ...reason('consent_evidence_checking') });
    await setStatus(pending, 'scanning');
    await expect(
      run(caller, recordConsent, consentOf(k, { evidenceFileId: pending })),
    ).rejects.toMatchObject(reason('consent_evidence_checking'));
    const refused = await upload(caller);
    await setStatus(refused, 'rejected');
    await expect(
      run(caller, recordConsent, consentOf(k, { evidenceFileId: refused })),
    ).rejects.toMatchObject({ code: 'validation_failed', ...reason('consent_evidence_refused') });
  });

  it('refuses a file of another purpose, of another company, or one the caller may not read', async () => {
    const k = await customerOf(caller);
    // A company logo every principal of the company may read, but not proof of consent.
    const logo = await storedFile(1, 'entity_logo', caller.id);
    await expect(
      run(caller, recordConsent, consentOf(k, { evidenceFileId: logo })),
    ).rejects.toMatchObject({ code: 'not_found', ...reason('consent_evidence_missing') });
    // A colleague's proof: a caller at own scope reads only the proof they uploaded.
    const theirs = await upload(colleague);
    await setStatus(theirs, 'ready');
    await expect(
      run(caller, recordConsent, consentOf(k, { evidenceFileId: theirs })),
    ).rejects.toMatchObject(reason('consent_evidence_missing'));
    // Proof held by another company, named by someone who reads both companies' proof.
    const executive = await createTestPrincipal('executive', [1, 2]);
    const elsewhere = await storedFile(2, 'consent_evidence', executive.id);
    await expect(
      run(executive, recordConsent, consentOf(k, { evidenceFileId: elsewhere })),
    ).rejects.toMatchObject(reason('consent_evidence_missing'));
    await expect(
      run(caller, recordConsent, consentOf(k, { evidenceFileId: newId() })),
    ).rejects.toMatchObject(reason('consent_evidence_missing'));
  });

  it('is refused with proof to a caller without crm.account.write, or in another company', async () => {
    const k = await customerOf(caller);
    const fileId = await upload(caller);
    await setStatus(fileId, 'ready');
    const accounts = await createTestPrincipal('accounts', [1]);
    await expect(
      run(accounts, recordConsent, consentOf(k, { evidenceFileId: fileId })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(caller, recordConsent, consentOf(k, { entityId: 2, evidenceFileId: fileId })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('crm.consent.withdraw', () => {
  it('withdraws once, and the withdrawal stands', async () => {
    const k = await customerOf(caller);
    const made = (await run(caller, recordConsent, consentOf(k))) as { id: string };
    const input = { entityId: 1, accountId: k.accountId, consentId: made.id };
    const withdrawn = (await run(caller, withdrawConsent, input)) as { withdrawnAt: string };
    expect(withdrawn.withdrawnAt).not.toBeNull();
    await expect(run(caller, withdrawConsent, input)).rejects.toMatchObject(
      reason('consent_already_withdrawn'),
    );
    // Not even the table owner can bring it back or change its evidence.
    await expect(
      asMigrator((m) => m`update consents set withdrawn_at = null where id = ${made.id}`),
    ).rejects.toMatchObject({ constraint_name: 'consents_withdrawal_fixed' });
    await expect(
      asMigrator(
        (m) =>
          m`update consents set evidence_file_id = null, text_version = 'v9' where id = ${made.id}`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'consents_evidence_fixed' });
    const types = await asMigrator(
      (m) => m<{ type: string }[]>`
        select type from activities where account_id = ${k.accountId} order by created_at, id`,
    );
    expect(types.map((t) => t.type)).toEqual([
      'lead_created',
      'consent_recorded',
      'consent_withdrawn',
    ]);
  });

  it('refuses a consent of another customer, or of a customer the caller cannot see', async () => {
    const k = await customerOf(caller);
    const other = await customerOf(caller);
    const made = (await run(caller, recordConsent, consentOf(other))) as { id: string };
    await expect(
      run(caller, withdrawConsent, { entityId: 1, accountId: k.accountId, consentId: made.id }),
    ).rejects.toMatchObject(reason('consent_missing'));
    await expect(
      run(colleague, withdrawConsent, {
        entityId: 1,
        accountId: other.accountId,
        consentId: made.id,
      }),
    ).rejects.toMatchObject(reason('consent_missing'));
  });
});
