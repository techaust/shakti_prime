import { newId } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { randomInt } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/command/execute';
import { createLead } from '../../src/commands/crm/create-lead';
import { IDEMPOTENCY_FRONT_SECONDS } from '../../src/idempotency/front';
import { memoryKeyValue, type KeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';

// F1 (the STATUS follow-up "Mobile tokens and the Redis front"): the key-value store in front of
// `idempotency_keys` answers the field app's retry of a committed call without a transaction. The
// table stays the authority: the front answers only the same caller's exact repeat, after the
// runner's own guard, and anything else goes to the table.

afterAll(closeDb);

function newLead() {
  return {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: {
      name: `Front test ${newId().slice(-8)}`,
      phone: `9${String(randomInt(100_000_000, 999_999_999))}`,
    },
    account: { type: 'farm' },
  };
}

async function contactsNamed(name: string): Promise<number> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from contacts where name = ${name}`,
  );
  return row?.n ?? -1;
}

/** Takes the key out of the table, so only the front can still answer a repeat. */
async function dropKey(principalId: string, key: string): Promise<void> {
  await asMigrator(
    (m) => m`delete from idempotency_keys where principal_id = ${principalId} and key = ${key}`,
  );
}

describe('the Redis front of idempotency_keys', () => {
  it('keeps a committed answer for a day and answers the exact repeat from it', async () => {
    const front = memoryKeyValue();
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const input = newLead();
    const key = newId();
    const options = { idempotencyKey: key, idempotencyFront: front };
    const first = await executeCommand(caller, { entityIds: [1] }, createLead, input, options);
    const kept = JSON.parse((await front.get(`idem:${caller.id}:${key}`)) ?? '{}') as {
      command?: string;
      response?: unknown;
    };
    expect(kept).toMatchObject({ command: 'crm.lead.create', response: first });

    // With the table's key gone, a repeat without the front would create the lead again; the front
    // answers it with the first answer and nothing is written.
    await dropKey(caller.id, key);
    const repeat = await executeCommand(caller, { entityIds: [1] }, createLead, input, options);
    expect(repeat).toEqual(first);
    expect(await contactsNamed(input.contact.name)).toBe(1);
    expect(IDEMPOTENCY_FRONT_SECONDS).toBe(86_400);
  });

  it('sends other input under the same key to the table, which refuses it', async () => {
    const front = memoryKeyValue();
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const key = newId();
    const options = { idempotencyKey: key, idempotencyFront: front, logger: memoryLogger() };
    await executeCommand(caller, { entityIds: [1] }, createLead, newLead(), options);
    const other = newLead();
    await expect(
      executeCommand(caller, { entityIds: [1] }, createLead, other, options),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'idempotency_mismatch' } });
    expect(await contactsNamed(other.contact.name)).toBe(0);
  });

  it('answers nobody but the caller, and refuses a caller the guard refuses', async () => {
    const front = memoryKeyValue();
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const input = newLead();
    const key = newId();
    await executeCommand(caller, { entityIds: [1] }, createLead, input, {
      idempotencyKey: key,
      idempotencyFront: front,
    });
    // Another person with the same key makes their own lead.
    const colleague = await createTestPrincipal('tele_caller_cc', [1]);
    const theirs = newLead();
    await executeCommand(colleague, { entityIds: [1] }, createLead, theirs, {
      idempotencyKey: key,
      idempotencyFront: front,
    });
    expect(await contactsNamed(theirs.contact.name)).toBe(1);
    // The same person without the grant now (a role change) is refused before any answer.
    const demoted = { ...caller, permissions: [] };
    await expect(
      executeCommand(demoted, { entityIds: [1] }, createLead, input, {
        idempotencyKey: key,
        idempotencyFront: front,
        logger: memoryLogger(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps no answer of a call that failed, and works on when the store fails', async () => {
    const front = memoryKeyValue();
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const key = newId();
    await expect(
      executeCommand(caller, { entityIds: [1] }, createLead, { ...newLead(), pipelineKey: 'none' }, {
        idempotencyKey: key,
        idempotencyFront: front,
        logger: memoryLogger(),
      }),
    ).rejects.toBeDefined();
    expect(await front.get(`idem:${caller.id}:${key}`)).toBeNull();

    const broken: KeyValue = {
      ...memoryKeyValue(),
      get: () => Promise.reject(new Error('store down')),
      set: () => Promise.reject(new Error('store down')),
    };
    const logger = memoryLogger();
    const input = newLead();
    const options = { idempotencyKey: newId(), idempotencyFront: broken, logger };
    const first = await executeCommand(caller, { entityIds: [1] }, createLead, input, options);
    expect(await executeCommand(caller, { entityIds: [1] }, createLead, input, options)).toEqual(
      first,
    );
    expect(await contactsNamed(input.contact.name)).toBe(1);
    expect(logger.entries.map((l) => l.event)).toContain('idempotency.front_miss');
  });
});
