import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AUTH_TABLES, closeDb, RLS_TABLES, withoutContext } from '../../src/testing/index';

afterAll(closeDb);

describe('app_user role (docs/DATABASE.md §3)', () => {
  it('is not a superuser and cannot bypass RLS', async () => {
    const [row] = await withoutContext<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(row).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it.each([...RLS_TABLES, ...AUTH_TABLES])(
    'does not own %s and the table forces RLS',
    async (table) => {
      const [row] = await withoutContext<{ owner: string; enabled: boolean; forced: boolean }>(sql`
      select pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${table}
    `);
      expect(row?.owner).not.toBe('app_user');
      expect(row?.enabled).toBe(true);
      expect(row?.forced).toBe(true);
    },
  );

  /**
   * Append-only ledgers take no update; series counters are written only by app.next_document_no();
   * user_entity_roles is the one table replaced as a set (docs/DATABASE.md §6.1).
   */
  const NARROWER: Partial<
    Record<(typeof RLS_TABLES)[number], { i: boolean; u: boolean; d?: boolean }>
  > = {
    price_change_log: { i: true, u: false },
    document_sequences: { i: false, u: false },
    user_entity_roles: { i: true, u: true, d: true },
    users: { i: true, u: false },
  };

  it.each(RLS_TABLES)('may select, insert and update %s but never delete', async (table) => {
    const [row] = await withoutContext<{ s: boolean; i: boolean; u: boolean; d: boolean }>(sql`
      select has_table_privilege('app_user', ${table}, 'SELECT') as s,
             has_table_privilege('app_user', ${table}, 'INSERT') as i,
             has_table_privilege('app_user', ${table}, 'UPDATE') as u,
             has_table_privilege('app_user', ${table}, 'DELETE') as d
    `);
    expect(row).toEqual({ s: true, d: false, ...(NARROWER[table] ?? { i: true, u: true }) });
  });

  it('updates users through profile and status columns only; sign-in state stays with the auth module', async () => {
    const [row] = await withoutContext<{
      name: boolean;
      status: boolean;
      email: boolean;
      verified: boolean;
      totp: boolean;
      login: boolean;
    }>(sql`
      select has_column_privilege('app_user', 'users', 'name', 'UPDATE') as name,
             has_column_privilege('app_user', 'users', 'status', 'UPDATE') as status,
             has_column_privilege('app_user', 'users', 'email', 'UPDATE') as email,
             has_column_privilege('app_user', 'users', 'email_verified', 'UPDATE') as verified,
             has_column_privilege('app_user', 'users', 'two_factor_enabled', 'UPDATE') as totp,
             has_column_privilege('app_user', 'users', 'last_login_at', 'UPDATE') as login
    `);
    expect(row).toEqual({
      name: true,
      status: true,
      email: false,
      verified: false,
      totp: false,
      login: false,
    });
  });

  it('holds column privileges only on sessions and none on the other auth tables', async () => {
    const [row] = await withoutContext<{
      s: boolean;
      cs: boolean;
      cu: boolean;
      tok: boolean;
      d: boolean;
    }>(sql`
      select has_table_privilege('app_user', 'sessions', 'SELECT') as s,
             has_any_column_privilege('app_user', 'sessions', 'SELECT') as cs,
             has_any_column_privilege('app_user', 'sessions', 'UPDATE') as cu,
             has_column_privilege('app_user', 'sessions', 'token', 'SELECT') as tok,
             has_table_privilege('app_user', 'sessions', 'DELETE') as d
    `);
    expect(row).toEqual({ s: false, cs: true, cu: true, tok: false, d: false });
    for (const table of ['auth_accounts', 'auth_verifications', 'user_two_factor']) {
      const [priv] = await withoutContext<{ any: boolean; reporter: boolean }>(sql`
        select has_any_column_privilege('app_user', ${table}, 'SELECT') as any,
               has_any_column_privilege('readonly_reporter', ${table}, 'SELECT') as reporter
      `);
      expect(priv, table).toEqual({ any: false, reporter: false });
    }
  });

  it('has request timeouts so a stuck transaction cannot hold locks open', async () => {
    const [row] = await withoutContext<{ s: string; l: string; i: string }>(sql`
      select current_setting('statement_timeout') as s,
             current_setting('lock_timeout') as l,
             current_setting('idle_in_transaction_session_timeout') as i
    `);
    expect(row).toEqual({ s: '30s', l: '10s', i: '30s' });
  });

  it('only the application role may issue document numbers', async () => {
    const [row] = await withoutContext<{ app: boolean; reporter: boolean; pub: boolean }>(sql`
      select has_function_privilege('app_user', 'app.next_document_no(smallint,text,text,text)', 'execute') as app,
             has_function_privilege('readonly_reporter', 'app.next_document_no(smallint,text,text,text)', 'execute') as reporter,
             has_function_privilege('public', 'app.next_document_no(smallint,text,text,text)', 'execute') as pub
    `);
    expect(row).toEqual({ app: true, reporter: false, pub: false });
  });

  it('readonly_reporter may only select', async () => {
    const [row] = await withoutContext<{ s: boolean; i: boolean; d: boolean; bypass: boolean }>(sql`
      select has_table_privilege('readonly_reporter', 'entities', 'SELECT') as s,
             has_table_privilege('readonly_reporter', 'entities', 'INSERT') as i,
             has_table_privilege('readonly_reporter', 'entities', 'DELETE') as d,
             (select rolbypassrls from pg_roles where rolname = 'readonly_reporter') as bypass
    `);
    expect(row).toEqual({ s: true, i: false, d: false, bypass: false });
  });
});
