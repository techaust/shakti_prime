import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, RLS_TABLES, withoutContext } from '../../src/testing/index';

afterAll(closeDb);

describe('app_user role (docs/DATABASE.md §3)', () => {
  it('is not a superuser and cannot bypass RLS', async () => {
    const [row] = await withoutContext<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(row).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it.each(RLS_TABLES)('does not own %s and the table forces RLS', async (table) => {
    const [row] = await withoutContext<{ owner: string; enabled: boolean; forced: boolean }>(sql`
      select pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${table}
    `);
    expect(row?.owner).not.toBe('app_user');
    expect(row?.enabled).toBe(true);
    expect(row?.forced).toBe(true);
  });

  /** Append-only ledgers take no update; series counters are written only by app.next_document_no(). */
  const NARROWER: Partial<Record<(typeof RLS_TABLES)[number], { i: boolean; u: boolean }>> = {
    price_change_log: { i: true, u: false },
    document_sequences: { i: false, u: false },
  };

  it.each(RLS_TABLES)('may select, insert and update %s but never delete', async (table) => {
    const [row] = await withoutContext<{ s: boolean; i: boolean; u: boolean; d: boolean }>(sql`
      select has_table_privilege('app_user', ${table}, 'SELECT') as s,
             has_table_privilege('app_user', ${table}, 'INSERT') as i,
             has_table_privilege('app_user', ${table}, 'UPDATE') as u,
             has_table_privilege('app_user', ${table}, 'DELETE') as d
    `);
    expect(row).toEqual({ s: true, ...(NARROWER[table] ?? { i: true, u: true }), d: false });
  });

  it('has request timeouts so a stuck transaction cannot hold locks open', async () => {
    const [row] = await withoutContext<{ s: string; l: string; i: string }>(sql`
      select current_setting('statement_timeout') as s,
             current_setting('lock_timeout') as l,
             current_setting('idle_in_transaction_session_timeout') as i
    `);
    expect(row).toEqual({ s: '30s', l: '10s', i: '30s' });
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
