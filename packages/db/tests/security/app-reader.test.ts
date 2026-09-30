import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { readerConfigured } from '../../src/client';
import { withRequestContext } from '../../src/context';
import { optionalEnv } from '../../src/env';
import { assertLocalDatabase } from '../../src/testing/local-database';
import { closeDb, principalFor } from '../../src/testing/index';

afterAll(closeDb);

/** The database's own error, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const code = (cause as { code?: unknown }).code;
    return {
      ...(typeof code === 'string' ? { code } : {}),
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
  throw new Error('expected the statement to fail');
}

/** A direct connection as `app_reader`, outside any request context. */
async function asReader<T>(fn: (s: postgres.Sql) => Promise<T>): Promise<T> {
  const url = optionalEnv('DATABASE_URL_READER');
  if (url === undefined) throw new Error('DATABASE_URL_READER is not set for the suite');
  assertLocalDatabase(url);
  const reader = postgres(url, { max: 1, prepare: false });
  try {
    return await fn(reader);
  } finally {
    await reader.end();
  }
}

const COUNTED = ['entities', 'roles', 'opportunities', 'accounts', 'audit_logs', 'users'] as const;

async function counts(principal: Principal, reader: boolean): Promise<Record<string, number>> {
  return withRequestContext(
    principal,
    {},
    async ({ tx }) => {
      const out: Record<string, number> = {};
      for (const table of COUNTED) {
        const rows = (await tx.execute(
          sql`select count(*)::int as n from ${sql.identifier(table)}`,
        )) as unknown as { n: number }[];
        out[table] = rows[0]?.n ?? -1;
      }
      return out;
    },
    { readOnly: true, reader },
  );
}

describe('app_reader, the queries’ own pool (docs/DATABASE.md §3)', () => {
  it('is configured for the suite, as CI sets it', () => {
    expect(readerConfigured()).toBe(true);
  });

  it('reads what app_user reads, under the same policies, role by role and company by company', async () => {
    for (const role of ['executive', 'general_manager', 'tele_caller_cc', 'agent:chief'] as const) {
      for (const entities of [[1], [2], [1, 2, 3, 4]]) {
        const principal = principalFor(role, entities);
        expect({ role, entities, seen: await counts(principal, true) }).toEqual({
          role,
          entities,
          seen: await counts(principal, false),
        });
      }
    }
  });

  it('reads nothing without a request context', async () => {
    const rows = await asReader(
      (r) => r<{ n: number }[]>`select count(*)::int as n from opportunities`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('refuses a write for want of the privilege, even in a transaction opened for writing', async () => {
    const error = await failure(
      asReader((r) =>
        r.begin('read write', async (tx) => {
          await tx`insert into teams (id, entity_id, name) values (${newId()}, 1, 'refused team')`;
        }),
      ),
    );
    expect(error).toMatchObject({ code: '42501' });
    expect(error.message).toMatch(/permission denied/);
  });

  it('refuses a write in its request context before the privilege is even asked', async () => {
    const error = await failure(
      withRequestContext(
        principalFor('executive', [1]),
        {},
        ({ tx }) =>
          tx.execute(
            sql`insert into teams (id, entity_id, name) values (${newId()}, 1, 'refused')`,
          ),
        { reader: true },
      ),
    );
    expect(error).toMatchObject({ code: '25006' });
  });

  it('opens every transaction read-only by its own setting', async () => {
    const rows = await asReader(
      (r) => r<{ ro: string }[]>`select current_setting('transaction_read_only') as ro`,
    );
    expect(rows[0]?.ro).toBe('on');
  });
});
