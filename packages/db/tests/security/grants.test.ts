import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AUTH_TABLES,
  closeDb,
  CONFIG_TABLES,
  OUTBOX_TABLES,
  PLATFORM_TABLES,
  PRINCIPAL_TABLES,
  RLS_TABLES,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

describe('app_user role (docs/05-database.md §3)', () => {
  it('is not a superuser and cannot bypass RLS', async () => {
    const [row] = await withoutContext<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(row).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  // The loops below cover only the listed tables. A table missing from the lists would escape
  // every fail-closed and privilege check, so the lists are compared with the catalogue (AUDIT H3).
  it('lists every table in public, and every table there forces RLS', async () => {
    const rows = await withoutContext<{ name: string; enabled: boolean; forced: boolean }>(sql`
      select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      order by c.relname
    `);
    expect(rows.map((r) => r.name)).toEqual(
      [
        ...RLS_TABLES,
        ...CONFIG_TABLES,
        ...AUTH_TABLES,
        ...OUTBOX_TABLES,
        ...PRINCIPAL_TABLES,
        ...PLATFORM_TABLES,
      ].sort(),
    );
    expect(rows.filter((r) => !r.enabled || !r.forced).map((r) => r.name)).toEqual([]);
  });

  it.each([
    ...RLS_TABLES,
    ...CONFIG_TABLES,
    ...AUTH_TABLES,
    ...OUTBOX_TABLES,
    ...PRINCIPAL_TABLES,
    ...PLATFORM_TABLES,
  ])('does not own %s and the table forces RLS', async (table) => {
    const [row] = await withoutContext<{ owner: string; enabled: boolean; forced: boolean }>(sql`
      select pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${table}
    `);
    expect(row?.owner).not.toBe('app_user');
    expect(row?.enabled).toBe(true);
    expect(row?.forced).toBe(true);
  });

  /**
   * Append-only ledgers take no update, and price history is written only by its trigger;
   * audit_logs is append-only and written by the runner (insert, never update);
   * consents take a withdrawal only (column grant); series counters are written only by app.next_document_no();
   * user_entity_roles, a kit's components and a pump's curve are replaced as a set
   * (docs/05-database.md §6.1, §6.3).
   */
  const NARROWER: Partial<
    Record<(typeof RLS_TABLES)[number], { i: boolean; u: boolean; d?: boolean }>
  > = {
    price_change_log: { i: false, u: false },
    audit_logs: { i: true, u: false },
    activities: { i: true, u: false },
    // A task changes only its due time and state after the insert.
    tasks: { i: true, u: false },
    // A number comes off a contact through crm.contact.update, which keeps one (ADR 0008).
    contact_phones: { i: true, u: true, d: true },
    // A tag is only archived; a tag on a lead is put on or taken off (DATABASE §6.2).
    tags: { i: true, u: false },
    opportunity_tags: { i: true, u: false, d: true },
    consents: { i: true, u: false },
    document_sequences: { i: false, u: false },
    user_entity_roles: { i: true, u: true, d: true },
    // The role editor replaces a role's grants as a set (admin.role.permissions.set).
    role_permissions: { i: true, u: true, d: true },
    // The seed owns the catalogue and the roles; app_user updates only a role's customised
    // mark, a column-level grant (role-editor.test.ts).
    roles: { i: false, u: false },
    permissions: { i: false, u: false },
    kit_components: { i: true, u: true, d: true },
    pump_curves: { i: true, u: true, d: true },
    users: { i: true, u: false },
    // A saved template is written once; a job and a row update only their working columns,
    // never what the file said (migration 0041); a stored file only its status and the checks'
    // columns (0062, files.test.ts).
    files: { i: true, u: false },
    import_mapping_templates: { i: true, u: false },
    import_jobs: { i: true, u: false },
    import_rows: { i: true, u: false },
    // The PIN code import adds and corrects offices (taluk, district and state only) and its
    // rollback removes the ones it added (pin-codes.test.ts).
    pin_codes: { i: true, u: false, d: true },
    // A sizing is append-only: a new sizing is a new row.
    sizings: { i: true, u: false },
    // A call is append-only: an outcome is never changed, a new call is a new row.
    calls: { i: true, u: false },
    // A target is append-only: setting it again is a new row.
    targets: { i: true, u: false },
    // A candidate changes only its state and who decided it; a merge is written only by its
    // definers (DATABASE §4.1).
    duplicate_candidates: { i: true, u: false },
    customer_merges: { i: false, u: false },
    // A quote changes only its state and withdrawal reason (column grants, 0110); its lines and
    // versions are append-only.
    quotes: { i: true, u: false },
    quote_lines: { i: true, u: false },
    quote_versions: { i: true, u: false },
    // An order changes only its state, credit hold, release and cancel reason (column grants,
    // 0117); its lines and the dealer credit entries are append-only; a commission is written
    // only by its definers (DATABASE §4.1).
    sales_orders: { i: true, u: false },
    sales_order_lines: { i: true, u: false },
    dealer_terms: { i: true, u: false },
    dealer_outstanding: { i: true, u: false },
    commission_accruals: { i: false, u: false },
    // An agent setting changes its autonomy, cap and switch only; a run is written once; an
    // action changes only its decision, an inbox item only its state (agents.test.ts).
    agent_configs: { i: true, u: false },
    agent_runs: { i: true, u: false },
    agent_actions: { i: true, u: false },
    inbox_items: { i: true, u: false },
    // A vault file changes only its state (indexed again or archived, a column grant, 0123); its
    // chunks are written only by the index job's definer (knowledge.test.ts).
    knowledge_files: { i: true, u: false },
    knowledge_chunks: { i: false, u: false },
    // A notice is written only by the notify worker's definer; a person changes its read time
    // alone (notifications.test.ts).
    notifications: { i: false, u: false },
  };

  /**
   * Tables selected column by column: `entities`, whose sealed bank account no request role may
   * select (the test below).
   */
  const COLUMN_SELECT: ReadonlySet<string> = new Set(['entities']);

  it.each(RLS_TABLES)('may select, insert and update %s but never delete', async (table) => {
    const [row] = await withoutContext<{ s: boolean; i: boolean; u: boolean; d: boolean }>(sql`
      select (has_table_privilege('app_user', ${table}, 'SELECT')
              or (${COLUMN_SELECT.has(table)} and has_any_column_privilege('app_user', ${table}, 'SELECT'))) as s,
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

  it('selects every column of entities but the sealed bank account, as every request role', async () => {
    const rows = await withoutContext<{ role: string; column: string; s: boolean }>(sql`
      select r.role, c.column_name as column,
             has_column_privilege(r.role, 'entities', c.column_name, 'SELECT') as s
        from information_schema.columns c
       cross join (values ('app_user'), ('app_reader'), ('readonly_reporter')) as r(role)
       where c.table_schema = 'public' and c.table_name = 'entities'
       order by 1, 2
    `);
    expect(rows.length).toBeGreaterThan(3 * 10);
    for (const row of rows) {
      expect(row).toEqual({ ...row, s: row.column !== 'bank_json' });
    }
    const [table] = await withoutContext<{ user: boolean; reader: boolean; reporter: boolean }>(sql`
      select has_table_privilege('app_user', 'entities', 'SELECT') as user,
             has_table_privilege('app_reader', 'entities', 'SELECT') as reader,
             has_table_privilege('readonly_reporter', 'entities', 'SELECT') as reporter
    `);
    expect(table).toEqual({ user: false, reader: false, reporter: false });
  });

  it('readonly_reporter may only select', async () => {
    const [row] = await withoutContext<{ s: boolean; i: boolean; d: boolean; bypass: boolean }>(sql`
      select has_any_column_privilege('readonly_reporter', 'entities', 'SELECT') as s,
             has_table_privilege('readonly_reporter', 'entities', 'INSERT') as i,
             has_table_privilege('readonly_reporter', 'entities', 'DELETE') as d,
             (select rolbypassrls from pg_roles where rolname = 'readonly_reporter') as bypass
    `);
    expect(row).toEqual({ s: true, i: false, d: false, bypass: false });
  });
});

describe('database functions and hosted API roles (AUDIT H3, M1, M2)', () => {
  it('every security-definer function searches pg_temp last or nothing at all', async () => {
    const rows = await withoutContext<{ fn: string; path: string | null }>(sql`
      select n.nspname || '.' || p.proname as fn,
             (select substring(c from 'search_path=(.*)') from unnest(p.proconfig) c
               where c like 'search_path=%') as path
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname in ('app', 'public')
       order by 1
    `);
    expect(rows.length).toBeGreaterThan(0);
    const unsafe = rows.filter(
      (r) => r.path === null || !(r.path === '""' || r.path.endsWith('pg_temp')),
    );
    expect(unsafe).toEqual([]);
  });

  it('no security-definer function is executable by everyone or by reporting', async () => {
    const rows = await withoutContext<{ fn: string; grantee: string }>(sql`
      select n.nspname || '.' || p.proname as fn, coalesce(r.rolname, 'public') as grantee
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        left join pg_roles r on r.oid = a.grantee
       where p.prosecdef and n.nspname in ('app', 'public')
         and a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or r.rolname = 'readonly_reporter')
    `);
    expect(rows).toEqual([]);
  });

  it('every security-definer function, trigger functions included, is closed to everyone and to reporting (final audit)', async () => {
    // Read through the privilege check itself, so a grant inherited through public counts too.
    const rows = await withoutContext<{ fn: string; pub: boolean; reporter: boolean }>(sql`
      select p.oid::regprocedure::text as fn,
             has_function_privilege('public', p.oid, 'EXECUTE') as pub,
             has_function_privilege('readonly_reporter', p.oid, 'EXECUTE') as reporter
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname in ('app', 'public')
       order by 1
    `);
    expect(rows.map((r) => r.fn)).toContain('app.ensure_account_entity()');
    expect(rows.filter((r) => r.pub)).toEqual([]);
    expect(rows.filter((r) => r.reporter)).toEqual([]);
  });

  it('the customer scope helpers serve write policies only, so reporting may not call them (0050)', async () => {
    const helpers = ['app.account_in_scope(uuid,text)', 'app.contact_in_scope(uuid,text)'];
    for (const fn of helpers) {
      const [row] = await withoutContext<{ app: boolean; reporter: boolean; pub: boolean }>(sql`
        select has_function_privilege('app_user', ${fn}, 'EXECUTE') as app,
               has_function_privilege('readonly_reporter', ${fn}, 'EXECUTE') as reporter,
               has_function_privilege('public', ${fn}, 'EXECUTE') as pub
      `);
      expect(row, fn).toEqual({ app: true, reporter: false, pub: false });
    }
    // no read policy calls them: reads use a plain exists (docs/05-database.md §4.2)
    const readers = await withoutContext<{ policy: string }>(sql`
      select tablename || '.' || policyname as policy from pg_policies
       where cmd in ('SELECT', 'ALL')
         and coalesce(qual, '') || coalesce(with_check, '') ~ '(account|contact)_in_scope'
    `);
    expect(readers).toEqual([]);
  });

  it('no session may create temporary objects', async () => {
    const [row] = await withoutContext<{ app: boolean; pub: boolean }>(sql`
      select has_database_privilege('app_user', current_database(), 'TEMPORARY') as app,
             has_database_privilege('public', current_database(), 'TEMPORARY') as pub
    `);
    expect(row).toEqual({ app: false, pub: false });
  });

  it('the Supabase API roles hold nothing on application tables, sequences or functions', async () => {
    const roles = await withoutContext<{ name: string }>(sql`
      select rolname as name from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
    `);
    for (const { name } of roles) {
      const rows = await withoutContext<{ obj: string }>(sql`
        select c.relname as obj from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p', 'S', 'v')
           and (has_table_privilege(${name}, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                or (c.relkind = 'S' and has_sequence_privilege(${name}, c.oid, 'USAGE')))
        union all
        select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and has_function_privilege(${name}, p.oid, 'EXECUTE')
           and has_schema_privilege(${name}, 'app', 'USAGE')
      `);
      expect({ role: name, objects: rows.map((r) => r.obj) }).toEqual({ role: name, objects: [] });
    }
  });
});

describe('app_reader role (docs/05-database.md §3, docs/03-roadmap-appendix/phase1.md §5.2)', () => {
  it('logs in, cannot bypass RLS, is no superuser and reads only, as its own setting', async () => {
    const [row] = await withoutContext(sql`
      select r.rolcanlogin as login, r.rolsuper as super, r.rolbypassrls as bypass,
             r.rolcreaterole as createrole, r.rolcreatedb as createdb,
             (select array_agg(s order by s) from pg_db_role_setting d, unnest(d.setconfig) s
               where d.setrole = r.oid and d.setdatabase = 0) as settings
        from pg_roles r where r.rolname = 'app_reader'
    `);
    expect(row).toEqual({
      login: true,
      super: false,
      bypass: false,
      createrole: false,
      createdb: false,
      settings: [
        'default_transaction_read_only=on',
        'idle_in_transaction_session_timeout=30s',
        'lock_timeout=10s',
        'statement_timeout=30s',
      ],
    });
  });

  it('selects exactly what app_user selects, table by table and column by column, and writes nothing', async () => {
    const rows = await withoutContext<{
      table: string;
      app: boolean;
      reader: boolean;
      appAny: boolean;
      readerAny: boolean;
      write: boolean;
    }>(sql`
      select c.relname as table,
             has_table_privilege('app_user', c.oid, 'SELECT') as app,
             has_table_privilege('app_reader', c.oid, 'SELECT') as reader,
             has_any_column_privilege('app_user', c.oid, 'SELECT') as "appAny",
             has_any_column_privilege('app_reader', c.oid, 'SELECT') as "readerAny",
             has_table_privilege('app_reader', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
               or has_any_column_privilege('app_reader', c.oid, 'INSERT, UPDATE, REFERENCES') as write
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
       order by 1
    `);
    expect(rows.length).toBeGreaterThan(30);
    for (const r of rows) {
      expect({ table: r.table, reader: r.reader, readerAny: r.readerAny, write: r.write }).toEqual({
        table: r.table,
        reader: r.app,
        readerAny: r.appAny,
        write: false,
      });
    }
    const columns = await withoutContext<{ column: string; app: boolean; reader: boolean }>(sql`
      select a.attname as column,
             has_column_privilege('app_user', 'sessions', a.attname, 'SELECT') as app,
             has_column_privilege('app_reader', 'sessions', a.attname, 'SELECT') as reader
        from pg_attribute a
       where a.attrelid = 'public.sessions'::regclass and a.attnum > 0 and not a.attisdropped
    `);
    expect(columns.find((c) => c.column === 'token')).toMatchObject({ app: false, reader: false });
    for (const c of columns)
      expect({ column: c.column, reader: c.reader }).toEqual({ column: c.column, reader: c.app });
  });

  it('every policy that lets app_user select names app_reader too', async () => {
    const missing = await withoutContext<{ policy: string }>(sql`
      select tablename || '.' || policyname as policy from pg_policies
       where cmd in ('SELECT', 'ALL') and 'app_user' = any (roles) and not 'app_reader' = any (roles)
    `);
    expect(missing).toEqual([]);
  });

  it('may call only the definers a read needs, and none that writes', async () => {
    const rows = await withoutContext<{ fn: string }>(sql`
      select p.oid::regprocedure::text as fn
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname in ('app', 'public')
         and has_function_privilege('app_reader', p.oid, 'EXECUTE')
       order by 1
    `);
    expect(rows.map((r) => r.fn)).toEqual([
      'app.customer_search_ids(text,text,integer)',
      // The dealer credit screen's figures, the one place the exposure is worked out (0117).
      'app.dealer_credit_position(smallint,uuid,uuid)',
      // An Executive's bank account form and the print loader.
      'app.entity_bank_envelope(smallint)',
      'app.lead_search_ids(text,boolean,text,integer)',
      'app.outbox_health(timestamp with time zone,uuid,integer)',
      // The quote print loader of the render worker (0110).
      'app.quote_for_print(uuid)',
      // The ⌘K search's candidate quotes (0110).
      'app.quote_search_ids(text,integer)',
      // The catalogue and GST rates screens ask it before they offer a change (0072).
      'app.request_covers_group()',
      // The sweep of abandoned uploads asks which companies to visit, as the worker
      // (pin-codes.test.ts).
      'app.stale_upload_entities(integer)',
      // The targets' progress: a caller's own figures, a team lead's team's (0125).
      'app.target_actuals(smallint,timestamp with time zone,timestamp with time zone,uuid[])',
      'app.user_is_active(uuid)',
      // A vault upload is read with a vault file the reader may read (files_knowledge_read, 0123).
      'app.vault_upload_readable(uuid)',
    ]);
  });

  it('owns nothing and holds no sequence', async () => {
    const [row] = await withoutContext<{ owned: number; sequences: number }>(sql`
      select (select count(*)::int from pg_class c where c.relowner = 'app_reader'::regrole) as owned,
             (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public'
                 and case when c.relkind = 'S'
                          then has_sequence_privilege('app_reader', c.oid, 'USAGE, UPDATE')
                          else false end) as sequences
    `);
    expect(row).toEqual({ owned: 0, sequences: 0 });
  });
});
