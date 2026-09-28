// executeQuery hands the query its transaction; the transaction is read-only, so a function passed
// to it cannot write around the command runner, its guard, the audit trail and the outbox.
import { newId, type Principal } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { executeQuery } from '../../src/command/execute';
import { memoryLogger } from '../../src/ports/logger';

afterAll(closeDb);

const logger = memoryLogger();

/** The Postgres error code of a failure, however many wrappers the driver put around it. */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function refusal(caller: Principal, write: Parameters<typeof executeQuery>[2]) {
  const error: unknown = await executeQuery(caller, {}, write, { name: 'test.write', logger }).then(
    () => undefined,
    (e: unknown) => e,
  );
  return sqlState(error);
}

async function viewsNamed(name: string): Promise<number> {
  const rows = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from saved_views where name = ${name}`,
  );
  return rows[0]?.n ?? -1;
}

describe('executeQuery runs in a read-only transaction', () => {
  it('still reads', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const rows = await executeQuery(caller, {}, ({ tx }) => tx.execute(sql`select 1 as one`), {
      name: 'test.read',
      logger,
    });
    expect([...rows]).toEqual([{ one: 1 }]);
  });

  it('refuses an insert through the query builder, and nothing is written', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const name = `Read only ${newId().slice(-8)}`;
    const state = await refusal(caller, ({ tx }) =>
      tx.insert(schema.savedViews).values({
        id: newId(),
        principalId: caller.id,
        screen: 'leads',
        name,
        settingsJson: {},
      }),
    );
    expect(state).toBe('25006');
    expect(await viewsNamed(name)).toBe(0);
  });

  it('refuses a raw insert, an update and a delete', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const name = `Read only ${newId().slice(-8)}`;
    expect(
      await refusal(
        caller,
        ({ tx }) => tx.execute(sql`
          insert into saved_views (id, principal_id, screen, name, settings_json)
          values (${newId()}, ${caller.id}, 'leads', ${name}, '{}'::jsonb)
        `),
      ),
    ).toBe('25006');
    expect(
      await refusal(caller, ({ tx }) =>
        tx
          .update(schema.savedViews)
          .set({ name })
          .where(eq(schema.savedViews.principalId, caller.id)),
      ),
    ).toBe('25006');
    expect(
      await refusal(caller, ({ tx }) =>
        tx.delete(schema.savedViews).where(eq(schema.savedViews.principalId, caller.id)),
      ),
    ).toBe('25006');
    expect(await viewsNamed(name)).toBe(0);
  });

  it('cannot switch the transaction back to read-write', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    expect(
      await refusal(caller, ({ tx }) => tx.execute(sql`set transaction read write`)),
    ).toBeDefined();
  });
});
