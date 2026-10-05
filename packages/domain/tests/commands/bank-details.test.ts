import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { updateEntity } from '../../src/commands/org/update-entity';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import type { Logger } from '../../src/ports/logger';
import { envelopeCipher, localKeyProvider } from '../../src/privacy/field-cipher';
import {
  openBankDetails,
  readEntityBankDetails,
  readSealedBankDetails,
} from '../../src/queries/org/bank-details';
import { loadCompanyForPrint } from '../../src/queries/org/company-print';
import { listEntities } from '../../src/queries/org/list-entities';

afterAll(closeDb);

/** The bank account lives on entity 3 here; the other suites leave it alone. */
const ENTITY = 3;
const cipher = envelopeCipher(localKeyProvider(randomBytes(32).toString('base64')));
const ACCOUNT = {
  bankName: 'State Bank of India',
  accountNumber: '30187264519',
  ifsc: 'SBIN0011528',
  branch: 'Sitapura, Jaipur',
};

let executive: Principal;
let saved: unknown;

beforeAll(async () => {
  executive = await createTestPrincipal('executive', [ENTITY]);
  const [row] = await asMigrator(
    (m) => m<{ bank: unknown }[]>`select bank_json as bank from entities where id = ${ENTITY}`,
  );
  saved = row?.bank ?? null;
});

afterAll(async () => {
  await asMigrator(
    (m) =>
      m`update entities set bank_json = ${saved === null ? null : m.json(saved as never)} where id = ${ENTITY}`,
  );
});

const setBank = (principal: Principal, bankDetails: unknown, entityId = ENTITY) =>
  asPrincipal(principal, (context) =>
    runCommand(
      updateEntity,
      { context, audit, outbox, fieldCipher: cipher },
      { entityId, bankDetails },
    ),
  );

async function auditRow(requestId: string) {
  const [row] = await asMigrator(
    (m) => m<{ input: unknown; before: unknown; after: unknown; outcome: string }[]>`
      select input_json as input, before_json as before, after_json as after, outcome
        from audit_logs where request_id = ${requestId} and command = 'org.entity.update'`,
  );
  return row;
}

describe('org.entity.update: the bank account (docs/SECURITY.md §5)', () => {
  it('is refused to a General Manager, an agent and the worker principal', async () => {
    for (const role of ['general_manager', 'agent:triage', 'system:workers'] as const) {
      await expect(setBank(principalFor(role, [ENTITY]), ACCOUNT)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('answers not_found for a company outside the request', async () => {
    const other = await createTestPrincipal('executive', [1]);
    await expect(setBank(other, ACCOUNT)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses an account number, IFSC or bank in the wrong shape', async () => {
    for (const wrong of [
      { ...ACCOUNT, accountNumber: '1234' },
      { ...ACCOUNT, accountNumber: '3018 7264 519x' },
      { ...ACCOUNT, ifsc: 'SBIN1011528' },
      { ...ACCOUNT, bankName: 'S' },
      { ...ACCOUNT, swift: 'SBININBB' },
    ]) {
      await expect(setBank(executive, wrong)).rejects.toMatchObject({ code: 'validation_failed' });
    }
  });

  it('is unavailable without a field cipher, and stores nothing', async () => {
    await expect(
      asPrincipal(executive, (context) =>
        runCommand(
          updateEntity,
          { context, audit, outbox },
          {
            entityId: ENTITY,
            bankDetails: ACCOUNT,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'integration_unavailable' });
  });

  it('stores the account sealed, audits its last four digits only and logs none of it', async () => {
    const lines: string[] = [];
    const logger: Logger = {
      log: (level, event, fields) => {
        lines.push(JSON.stringify({ level, event, fields }));
      },
    };
    const requestId = newId();
    const emitted = memoryOutboxSink();
    await asMigrator((m) => m`update entities set bank_json = null where id = ${ENTITY}`);
    const dto = await executeCommand(
      executive,
      { entityIds: [ENTITY], requestId },
      updateEntity,
      { entityId: ENTITY, bankDetails: ACCOUNT },
      { fieldCipher: cipher, logger },
    );
    expect(dto).toMatchObject({ id: ENTITY, bankDetailsSet: true });
    expect(dto).not.toHaveProperty('bankDetails');

    const [stored] = await asMigrator(
      (m) => m<{ bank: unknown; set: boolean }[]>`
        select bank_json as bank, bank_details_set as set from entities where id = ${ENTITY}`,
    );
    const text = JSON.stringify(stored?.bank);
    expect(stored?.set).toBe(true);
    expect(stored?.bank).toMatchObject({ v: 1, keyId: 'local' });
    for (const clear of Object.values(ACCOUNT)) expect(text).not.toContain(clear);
    expect(await openBankDetails(cipher, ENTITY, stored?.bank)).toEqual(ACCOUNT);

    const row = await auditRow(requestId);
    expect(row).toMatchObject({
      outcome: 'ok',
      before: { bankAccount: null },
      after: { bankAccount: '****4519' },
      input: { entityId: ENTITY, bankAccount: '****4519' },
    });
    const recorded = JSON.stringify(row);
    for (const clear of Object.values(ACCOUNT)) expect(recorded).not.toContain(clear);
    for (const line of lines) {
      for (const clear of Object.values(ACCOUNT)) expect(line).not.toContain(clear);
    }
    expect(lines.length).toBeGreaterThan(0);

    // A second account replaces the first; the audit shows both endings and nothing more.
    const second = { ...ACCOUNT, accountNumber: '50100213877662', ifsc: 'HDFC0001234' };
    const secondId = newId();
    await asPrincipal(executive, (context) =>
      runCommand(
        updateEntity,
        {
          context: { ...context, requestId: secondId },
          audit,
          outbox: emitted,
          fieldCipher: cipher,
        },
        { entityId: ENTITY, bankDetails: second },
      ),
    );
    expect(await auditRow(secondId)).toMatchObject({
      before: { bankAccount: '****4519' },
      after: { bankAccount: '****7662' },
    });
    expect(emitted.records).toEqual([
      expect.objectContaining({
        type: 'org.entity.updated',
        payload: { fields: ['bankDetails'], v: 1 },
      }),
    ]);

    // Cleared with null: nothing is printed for payment any more.
    await setBank(executive, null);
    const [cleared] = await asMigrator(
      (m) => m<{ bank: unknown; set: boolean }[]>`
        select bank_json as bank, bank_details_set as set from entities where id = ${ENTITY}`,
    );
    expect(cleared).toEqual({ bank: null, set: false });
  });
});

describe('reading a bank account back (docs/SECURITY.md §5)', () => {
  beforeAll(async () => {
    await setBank(executive, ACCOUNT);
  });

  it('opens it in clear for an Executive and the worker principal only', async () => {
    const read = (principal: Principal) =>
      asPrincipal(principal, (ctx) => readEntityBankDetails(ctx, cipher, ENTITY));
    expect(await read(executive)).toEqual({ entityId: ENTITY, bankDetails: ACCOUNT });
    expect(await read(principalFor('system:workers', [ENTITY]))).toEqual({
      entityId: ENTITY,
      bankDetails: ACCOUNT,
    });
    for (const role of [
      'general_manager',
      'accounts',
      'sales_team_lead',
      'tele_caller_cc',
      'agent:triage',
      'agent:chief',
    ] as const) {
      await expect(read(principalFor(role, [ENTITY]))).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('is refused by the database to anyone else, and the sealed column to every request role', async () => {
    const gm = principalFor('general_manager', [ENTITY]);
    await expect(
      asPrincipal(gm, (ctx) => readSealedBankDetails(ctx, ENTITY)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(gm, (ctx) =>
        ctx.tx.execute(sql`select app.entity_bank_envelope(${ENTITY}::smallint)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    // Not even an Executive selects the column itself: only the definer reads it.
    await expect(
      asPrincipal(executive, (ctx) =>
        ctx.tx.execute(sql`select bank_json from entities where id = ${ENTITY}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    const [privileges] = await asMigrator(
      (m) => m<{ user: boolean; reader: boolean; reporter: boolean; set: boolean }[]>`
        select has_column_privilege('app_user', 'entities', 'bank_json', 'SELECT') as user,
               has_column_privilege('app_reader', 'entities', 'bank_json', 'SELECT') as reader,
               has_column_privilege('readonly_reporter', 'entities', 'bank_json', 'SELECT') as reporter,
               has_column_privilege('app_user', 'entities', 'bank_details_set', 'SELECT') as set`,
    );
    expect(privileges).toEqual({ user: false, reader: false, reporter: false, set: true });
  });

  it('answers not_found for a company outside the request, and the definer refuses it', async () => {
    const other = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(other, (ctx) => readEntityBankDetails(ctx, cipher, ENTITY)),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      asPrincipal(other, (ctx) => readSealedBankDetails(ctx, ENTITY)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('does not open an account copied to another company', async () => {
    const [row] = await asMigrator(
      (m) => m<{ bank: unknown }[]>`select bank_json as bank from entities where id = ${ENTITY}`,
    );
    await expect(openBankDetails(cipher, 4, row?.bank)).rejects.toThrow();
  });

  it('never leaves in the company list, and the print loader reads only its own company', async () => {
    const gm = principalFor('general_manager', [ENTITY]);
    const companies = await asPrincipal(gm, (ctx) => listEntities(ctx));
    expect(JSON.stringify(companies)).not.toContain(ACCOUNT.accountNumber);
    expect(companies.find((c) => c.id === ENTITY)).toMatchObject({ bankDetailsSet: true });

    const worker = principalFor('system:workers', [ENTITY]);
    const read = await asPrincipal(worker, (ctx) => loadCompanyForPrint(ctx, ENTITY));
    expect(read.entity.id).toBe(ENTITY);
    expect(await openBankDetails(cipher, ENTITY, read.sealedBank)).toEqual(ACCOUNT);
    await expect(asPrincipal(worker, (ctx) => loadCompanyForPrint(ctx, 4))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
