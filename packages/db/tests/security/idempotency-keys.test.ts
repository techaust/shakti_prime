import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

const HASH = 'a'.repeat(64);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

function insertKey(principalId: string, key: string) {
  return sql`insert into idempotency_keys (principal_id, key, command, input_hash)
             values (${principalId}, ${key}, 'crm.lead.create', ${HASH})`;
}

async function keysSeenBy(principal: Principal, key: string): Promise<number> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select count(*)::int as n from idempotency_keys where key = ${key}`,
    )) as unknown as { n: number }[];
    return rows[0]?.n ?? -1;
  });
}

let owner: Principal;
let other: Principal;
let key: string;

beforeAll(async () => {
  owner = await createTestPrincipal('tele_caller_cc', [1]);
  other = await createTestPrincipal('executive');
  key = newId();
  await asPrincipal(owner, ({ tx }) => tx.execute(insertKey(owner.id, key)));
});

describe('idempotency keys belong to their caller (docs/03-roadmap-appendix/backend-weeks-3-5.md §5)', () => {
  it('shows nothing and takes nothing without a request context', async () => {
    const [row] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from idempotency_keys`,
    );
    expect(row?.n).toBe(0);
    expect(await failure(withoutContext(insertKey(owner.id, newId())))).toMatch(
      /row-level security/,
    );
  });

  it('shows a caller its own keys, whatever its entity scope, and nobody else', async () => {
    expect(await keysSeenBy(owner, key)).toBe(1);
    expect(await keysSeenBy({ ...owner, entityIds: [] }, key)).toBe(1);
    expect(await keysSeenBy(other, key)).toBe(0);
  });

  it('refuses a key written in another caller’s name', async () => {
    expect(
      await failure(asPrincipal(other, ({ tx }) => tx.execute(insertKey(owner.id, newId())))),
    ).toMatch(/row-level security/);
  });

  it('lets a caller store the answer of its own key and nothing else', async () => {
    const stored = await asPrincipal(owner, async ({ tx }) => {
      const rows = (await tx.execute(sql`
        update idempotency_keys set response_json = '{"ok": true}'
         where principal_id = ${owner.id} and key = ${key} returning key`)) as unknown as unknown[];
      return rows.length;
    });
    expect(stored).toBe(1);
    const foreign = await asPrincipal(other, async ({ tx }) => {
      const rows = (await tx.execute(sql`
        update idempotency_keys set response_json = '{}' where key = ${key} returning key`)) as unknown as unknown[];
      return rows.length;
    });
    expect(foreign).toBe(0);
    for (const statement of [
      sql`update idempotency_keys set command = 'org.entity.update' where key = ${key}`,
      sql`update idempotency_keys set expires_at = now() + interval '1 year' where key = ${key}`,
      sql`delete from idempotency_keys where key = ${key}`,
    ]) {
      expect(await failure(asPrincipal(owner, ({ tx }) => tx.execute(statement)))).toMatch(
        /permission denied/,
      );
    }
  });

  it('grants the application select, insert and an update of the answer only', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'idempotency_keys', 'SELECT') as s,
             has_table_privilege('app_user', 'idempotency_keys', 'INSERT') as i,
             has_table_privilege('app_user', 'idempotency_keys', 'DELETE') as d,
             has_column_privilege('app_user', 'idempotency_keys', 'response_json', 'UPDATE') as answer,
             has_column_privilege('app_user', 'idempotency_keys', 'input_hash', 'UPDATE') as hash,
             has_any_column_privilege('readonly_reporter', 'idempotency_keys', 'SELECT') as reporter,
             has_any_column_privilege('outbox_publisher', 'idempotency_keys', 'SELECT') as publisher
    `);
    expect(row).toEqual({
      s: true,
      i: true,
      d: false,
      answer: true,
      hash: false,
      reporter: false,
      publisher: false,
    });
  });
});

describe('expired keys are removed by pg_cron only', () => {
  it('no request role may run the purge', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.purge_idempotency_keys()', 'execute') as app,
             has_function_privilege('auth_service', 'app.purge_idempotency_keys()', 'execute') as auth,
             has_function_privilege('outbox_publisher', 'app.purge_idempotency_keys()', 'execute') as outbox,
             has_function_privilege('readonly_reporter', 'app.purge_idempotency_keys()', 'execute') as reporter,
             has_function_privilege('public', 'app.purge_idempotency_keys()', 'execute') as pub
    `);
    expect(row).toEqual({ app: false, auth: false, outbox: false, reporter: false, pub: false });
  });

  it('removes an expired key and keeps a live one, on the daily schedule', async () => {
    const expired = newId();
    const live = newId();
    const remaining = await asMigrator(async (m) => {
      await m`insert into idempotency_keys (principal_id, key, command, input_hash, expires_at)
              values (${owner.id}, ${expired}, 'crm.lead.create', ${HASH}, now() - interval '1 minute'),
                     (${owner.id}, ${live}, 'crm.lead.create', ${HASH}, default)`;
      await m`select app.purge_idempotency_keys()`;
      return m<{ key: string }[]>`
        select key from idempotency_keys where key in (${expired}, ${live})`;
    });
    expect(remaining.map((r) => r.key)).toEqual([live]);
    const jobs = await asMigrator(
      (m) => m<{ schedule: string; command: string }[]>`
        select schedule, command from cron.job where jobname = 'idempotency-keys-purge'`,
    );
    expect(jobs).toEqual([
      { schedule: '30 2 * * *', command: 'select app.purge_idempotency_keys()' },
    ]);
  });
});
