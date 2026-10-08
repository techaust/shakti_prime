import { newId } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { randomInt } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/command/execute';
import { createLead } from '../../src/commands/crm/create-lead';
import { memoryLogger } from '../../src/ports/logger';

afterAll(closeDb);

/** A lead with its own name and number, so counting its contacts counts this test's leads only. */
function newLead() {
  return {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: {
      name: `Retry test ${newId().slice(-8)}`,
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

async function keyStored(principalId: string, key: string): Promise<boolean> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`
      select count(*)::int as n from idempotency_keys where principal_id = ${principalId} and key = ${key}`,
  );
  return row?.n === 1;
}

describe('a command sent twice with one key acts once (docs/03-roadmap-appendix/backend-weeks-3-5.md §5)', () => {
  it('creates one lead and answers the repeat with the first answer', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const input = newLead();
    const key = newId();
    const first = await executeCommand(caller, { entityIds: [1] }, createLead, input, {
      idempotencyKey: key,
    });
    const repeat = await executeCommand(caller, { entityIds: [1] }, createLead, input, {
      idempotencyKey: key,
    });
    expect(repeat).toEqual(first);
    expect(await contactsNamed(input.contact.name)).toBe(1);
  });

  it('refuses the same key with other details', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const key = newId();
    await executeCommand(caller, { entityIds: [1] }, createLead, newLead(), {
      idempotencyKey: key,
    });
    const other = newLead();
    await expect(
      executeCommand(caller, { entityIds: [1] }, createLead, other, {
        idempotencyKey: key,
        logger: memoryLogger(),
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'idempotency_mismatch' } });
    expect(await contactsNamed(other.contact.name)).toBe(0);
  });

  it('keeps each caller’s keys apart', async () => {
    const key = newId();
    const a = await createTestPrincipal('tele_caller_cc', [1]);
    const b = await createTestPrincipal('tele_caller_cc', [1]);
    const leadA = newLead();
    const leadB = newLead();
    await executeCommand(a, { entityIds: [1] }, createLead, leadA, { idempotencyKey: key });
    await executeCommand(b, { entityIds: [1] }, createLead, leadB, { idempotencyKey: key });
    expect(await contactsNamed(leadA.contact.name)).toBe(1);
    expect(await contactsNamed(leadB.contact.name)).toBe(1);
  });

  it('leaves no key after a refused or failed call, so a retry runs', async () => {
    const key = newId();
    const inventory = await createTestPrincipal('inventory_manager', [1]);
    await expect(
      executeCommand(inventory, { entityIds: [1] }, createLead, newLead(), {
        idempotencyKey: key,
        logger: memoryLogger(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await keyStored(inventory.id, key)).toBe(false);

    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(
      executeCommand(
        caller,
        { entityIds: [1] },
        createLead,
        { ...newLead(), pipelineKey: 'no_such_pipeline' },
        { idempotencyKey: key, logger: memoryLogger() },
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await keyStored(caller.id, key)).toBe(false);

    const retry = newLead();
    await executeCommand(caller, { entityIds: [1] }, createLead, retry, { idempotencyKey: key });
    expect(await contactsNamed(retry.contact.name)).toBe(1);
    expect(await keyStored(caller.id, key)).toBe(true);
  });

  it('creates one lead when two calls with one key arrive together', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const input = newLead();
    const key = newId();
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        executeCommand(caller, { entityIds: [1] }, createLead, input, {
          idempotencyKey: key,
          logger: memoryLogger(),
        }),
      ),
    );
    expect(await contactsNamed(input.contact.name)).toBe(1);
    const answered = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.id);
    expect(answered.length).toBeGreaterThanOrEqual(1);
    expect(new Set(answered).size).toBe(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason).toMatchObject({
          code: 'conflict',
          details: { reason: 'concurrent_change' },
        });
      }
    }
  });
});
