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
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// crm.consent.record and crm.consent.withdraw (CRM-10): consent per channel and purpose with its
// source, text version and time; a withdrawal stands, and the evidence is fixed once written.

afterAll(closeDb);

let caller: Principal;
let colleague: Principal;

beforeAll(async () => {
  const teamId = await createTestTeam(1, 'consent team');
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  colleague = await createTestPrincipal('tele_caller_cc', [1], { teamId });
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
    };
    expect(made).toMatchObject({ withdrawnAt: null, hasEvidence: false });
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
      textVersion: 'v2',
    });
  });

  it('refuses a consent given in the future, or an evidence file the caller cannot see', async () => {
    const k = await customerOf(caller);
    await expect(
      run(
        caller,
        recordConsent,
        consentOf(k, { givenAt: new Date(Date.now() + 3_600_000).toISOString() }),
      ),
    ).rejects.toMatchObject(reason('consent_given_in_future'));
    await expect(
      run(caller, recordConsent, consentOf(k, { evidenceFileId: newId() })),
    ).rejects.toMatchObject(reason('consent_evidence_missing'));
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
