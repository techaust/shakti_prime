import { newId, type Principal } from '@shakti/contracts';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asOutboxPublisher,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  principalFor,
  testPhone,
} from '@shakti/db/testing';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/command/execute';
import { createLead } from '../../src/commands/crm/create-lead';
import { addNote } from '../../src/commands/crm/customer';
import { updateEntity } from '../../src/commands/org/update-entity';
import type { OutboxRecord } from '../../src/outbox/sink';
import { envelopeCipher, localKeyProvider } from '../../src/privacy/field-cipher';
import { openBankDetails } from '../../src/queries/org/bank-details';

// An Aadhaar number typed into any command's input keeps only its last four digits before the
// command sees it (docs/07-security.md §5, the runner's `maskInputIdentity()`): the stored row,
// the audit trail, the outbox and the idempotency record hold the masked text, and the fields a
// command leaves whole by design (`unmaskedFields`) keep their long numbers.

afterAll(closeDb);

/** A valid Aadhaar number (its Verhoeff check digit is 4) and the digits it must never show. */
const AADHAAR = '234567890124';
const HIDDEN = /2\D?3\D?4\D?5\D?6\D?7\D?8\D?9/;
/** The seeded triage agent, so its refusal row has a principal to point at. */
const AGENT_TRIAGE_ID = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage')?.id ?? '';

let teamId: string;
let caller: Principal;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'identity in text team');
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
});

async function auditRows(requestId: string) {
  return asMigrator(
    (m) => m<{ outcome: string; input: unknown; before: unknown; after: unknown }[]>`
      select outcome, input_json as input, before_json as before, after_json as after
        from audit_logs where request_id = ${requestId} order by created_at`,
  );
}

async function eventsOf(aggregateId: string) {
  return asOutboxPublisher(
    (p) => p<{ type: string; payload: unknown }[]>`
      select type, payload_json as payload from outbox_events where aggregate_id = ${aggregateId}`,
  );
}

async function newCustomer(contactName = 'Identity customer') {
  const events: OutboxRecord[] = [];
  const requestId = newId();
  const lead = await executeCommand(
    caller,
    { entityIds: [1], requestId },
    createLead,
    {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: contactName, phone: testPhone() },
      account: { type: 'farm' },
      site: { type: 'borewell', village: `Ward 2345 6789 0124 Kheda` },
    },
    { onCommitted: (stored) => void events.push(...stored) },
  );
  return { lead, requestId, events };
}

async function notesOf(accountId: string) {
  return asMigrator(
    (m) => m<{ body: string | null }[]>`
      select body from activities where account_id = ${accountId} and type = 'note'
       order by created_at, id`,
  );
}

describe('an Aadhaar number typed into a note (crm.note.add)', () => {
  it('stores only its last four digits, in the activity row, the audit row and the outbox', async () => {
    const { lead } = await newCustomer();
    const requestId = newId();
    const events: OutboxRecord[] = [];
    await executeCommand(
      caller,
      { entityIds: [1], requestId },
      addNote,
      {
        entityId: 1,
        accountId: lead.account.id,
        body: `Customer read out Aadhaar 2345 6789 0124 for the subsidy form`,
      },
      { onCommitted: (stored) => void events.push(...stored) },
    );
    expect(await notesOf(lead.account.id)).toEqual([
      { body: 'Customer read out Aadhaar XXXX XXXX 0124 for the subsidy form' },
    ]);
    const audit = await auditRows(requestId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.outcome).toBe('ok');
    expect(JSON.stringify(audit)).not.toMatch(HIDDEN);
    // The row holds the masked text itself, not only the scrubber's removal of the number.
    expect(JSON.stringify(audit)).toContain('XXXX XXXX 0124');
    expect(JSON.stringify(events)).not.toMatch(HIDDEN);
    expect(JSON.stringify(await eventsOf(lead.account.id))).not.toMatch(HIDDEN);
  });

  it('records a refused note with the number masked too', async () => {
    const { lead } = await newCustomer();
    const requestId = newId();
    // An agent is refused at the guard (people only), after the input was read and masked.
    await expect(
      executeCommand(
        principalFor('agent:triage', [1], { id: AGENT_TRIAGE_ID }),
        { entityIds: [1], requestId },
        addNote,
        {
          entityId: 1,
          accountId: lead.account.id,
          body: `Aadhaar ${AADHAAR}`,
        },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const audit = await auditRows(requestId);
    expect(audit.map((r) => r.outcome)).toEqual(['denied']);
    expect(JSON.stringify(audit)).not.toMatch(HIDDEN);
    expect(JSON.stringify(audit)).toContain('Aadhaar XXXXXXXX0124');
  });

  it('records a note for a company outside the caller’s access with the number masked', async () => {
    const { lead } = await newCustomer();
    const requestId = newId();
    // Refused before the runner starts, so the refusal row masks the input as it came.
    await expect(
      executeCommand(caller, { entityIds: [2], requestId }, addNote, {
        entityId: 2,
        accountId: lead.account.id,
        body: `Aadhaar 2345-6789-0124`,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const audit = await auditRows(requestId);
    expect(audit.map((r) => r.outcome)).toEqual(['denied']);
    expect(JSON.stringify(audit)).not.toMatch(HIDDEN);
    expect(JSON.stringify(audit)).toContain('Aadhaar XXXX-XXXX-0124');
  });

  it('replays the first answer to a repeat with the same key and the number as typed', async () => {
    const { lead } = await newCustomer();
    const idempotencyKey = newId();
    const input = { entityId: 1, accountId: lead.account.id, body: `Aadhaar no ${AADHAAR}` };
    const first = await executeCommand(caller, { entityIds: [1] }, addNote, input, {
      idempotencyKey,
    });
    const requestId = newId();
    const again = await executeCommand(caller, { entityIds: [1], requestId }, addNote, input, {
      idempotencyKey,
    });
    expect(again).toEqual(first);
    // The masked text hashes alike, so it is the same call too; other text is refused.
    const masked = { ...input, body: 'Aadhaar no XXXXXXXX0124' };
    expect(
      await executeCommand(caller, { entityIds: [1] }, addNote, masked, { idempotencyKey }),
    ).toEqual(first);
    await expect(
      executeCommand(
        caller,
        { entityIds: [1] },
        addNote,
        { ...input, body: 'Another note' },
        { idempotencyKey },
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'idempotency_mismatch' } });
    expect(await notesOf(lead.account.id)).toEqual([{ body: 'Aadhaar no XXXXXXXX0124' }]);
    // A replay writes no audit row.
    expect(await auditRows(requestId)).toEqual([]);
    const [key] = await asMigrator(
      (m) => m<{ response: unknown }[]>`
        select response_json as response from idempotency_keys
         where principal_id = ${caller.id} and key = ${idempotencyKey}`,
    );
    expect(JSON.stringify(key)).not.toMatch(HIDDEN);
  });
});

describe('an Aadhaar number inside a nested input (crm.lead.create)', () => {
  it('is masked in the contact and the site, the audit rows and the events', async () => {
    const { lead, requestId, events } = await newCustomer(`Ramesh UID 2345-6789-0124`);
    const [stored] = await asMigrator(
      (m) => m<{ name: string; village: string }[]>`
        select (select name from contacts where id = ${lead.contact?.id ?? ''}) as name,
               (select village from customer_sites where account_id = ${lead.account.id}) as village`,
    );
    expect(stored).toEqual({
      name: 'Ramesh UID XXXX-XXXX-0124',
      village: 'Ward XXXX XXXX 0124 Kheda',
    });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toMatch(HIDDEN);
    expect(JSON.stringify(await eventsOf(lead.id))).not.toMatch(HIDDEN);
    const audit = await auditRows(requestId);
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toMatch(HIDDEN);
    const timeline = await asMigrator(
      (m) => m<{ row: unknown }[]>`
        select to_jsonb(a) as row from activities a where account_id = ${lead.account.id}`,
    );
    expect(JSON.stringify(timeline)).not.toMatch(HIDDEN);
  });
});

describe('a field left whole by design (org.entity.update)', () => {
  /** Entity 3's bank account and UPI id, put back afterwards; bank-details.test.ts does the same. */
  const ENTITY = 3;
  const cipher = envelopeCipher(localKeyProvider(randomBytes(32).toString('base64')));
  let saved: { bank: unknown; upi: string | null } | undefined;
  let executive: Principal;

  beforeAll(async () => {
    executive = await createTestPrincipal('executive', [ENTITY]);
    [saved] = await asMigrator(
      (m) => m<{ bank: unknown; upi: string | null }[]>`
        select bank_json as bank, upi_id as upi from entities where id = ${ENTITY}`,
    );
  });

  afterAll(async () => {
    await asMigrator(
      (m) => m`update entities
        set bank_json = ${saved?.bank == null ? null : m.json(saved.bank as never)},
            upi_id = ${saved?.upi ?? null}
        where id = ${ENTITY}`,
    );
  });

  it('keeps a bank account number of an Aadhaar shape whole, sealed and opened again', async () => {
    const account = {
      bankName: 'State Bank of India',
      accountNumber: AADHAAR,
      ifsc: 'SBIN0011528',
      branch: 'Ward 2345 6789 0124, Jaipur',
    };
    const upiId = '919876543216@okaxis';
    const requestId = newId();
    await executeCommand(
      executive,
      { entityIds: [ENTITY], requestId },
      updateEntity,
      { entityId: ENTITY, bankDetails: account, upiId },
      { fieldCipher: cipher },
    );
    const [stored] = await asMigrator(
      (m) => m<{ bank: unknown; upi: string }[]>`
        select bank_json as bank, upi_id as upi from entities where id = ${ENTITY}`,
    );
    expect(await openBankDetails(cipher, ENTITY, stored?.bank)).toEqual({
      ...account,
      branch: 'Ward XXXX XXXX 0124, Jaipur',
    });
    expect(stored?.upi).toBe(upiId);
    const audit = await auditRows(requestId);
    expect(audit[0]).toMatchObject({ outcome: 'ok', after: { bankAccount: '****0124' } });
    expect(JSON.stringify(audit)).not.toMatch(HIDDEN);
  });
});
