// Applies migrations as the table owner (docs/05-database.md §3, §8). Application code never runs this.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { connectionOptions } from './connection';
import { optionalEnv, requireEnv } from './env';
import { journalProblems, migrationHash, readJournal } from './journal';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * The security-definer functions (numbering, customer attach, principal grants) write and read
 * tables that force row-level security, which the table owner passes only as a superuser or
 * with `bypassrls`. A migrator without either would leave them silently returning nothing.
 */
async function assertOwnerBypassesRls(sql: postgres.Sql): Promise<void> {
  const [row] = await sql<{ ok: boolean }[]>`
    select rolsuper or rolbypassrls as ok from pg_roles where rolname = current_user`;
  if (row?.ok !== true) {
    throw new Error('DATABASE_URL_MIGRATOR must connect as a superuser or a role with bypassrls');
  }
}

const LOGIN_ROLES = ['app_user', 'auth_service', 'outbox_publisher', 'app_reader'] as const;
type LoginRole = (typeof LOGIN_ROLES)[number] | 'app_backup';

/**
 * `app_user`, `auth_service`, `outbox_publisher`, `app_reader` and `readonly_reporter` are cluster
 * roles, so they are created here, not in SQL files. `auth_service` is the auth module's
 * connection: it may touch the identity tables only; `outbox_publisher` delivers `outbox_events`
 * and touches nothing else; `app_reader` is the queries' own pool, with `select` only under the
 * same policies as `app_user` (docs/05-database.md §3). A password is set when the role is created
 * and again only on `--rotate-passwords`, so the statement text does not land in the server log on
 * every run. `app_reader` is created whether or not its password is set, so the migrations can
 * grant to it; without `APP_READER_PASSWORD` it has no password and no one can sign in as it, and
 * `executeQuery()` keeps to `app_user`.
 *
 * `app_backup` is the 6-hourly backup's login (docs/05-database.md §3, §10): it reads every row of
 * every table, past the policies, so `pg_dump` copies the whole database, with `select` only and
 * at most two sessions. It runs no request, so none of the request roles' time limits apply to it
 * (`pg_dump` sets its own). It is created whether or not `APP_BACKUP_PASSWORD` is set; without it
 * no one can sign in as it.
 */
async function ensureRoles(
  sql: postgres.Sql,
  passwords: {
    appUser: string;
    authService: string;
    outboxPublisher: string;
    appReader: string | undefined;
    appBackup: string | undefined;
  },
  rotatePasswords: boolean,
): Promise<void> {
  const before = await sql<{ rolname: string }[]>`
    select rolname from pg_roles
     where rolname in ('app_user', 'auth_service', 'outbox_publisher', 'app_reader', 'app_backup',
                       'readonly_reporter')`;
  const existing = new Set(before.map((r) => r.rolname));
  await sql.unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'app_user') then
        create role app_user login nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'auth_service') then
        create role auth_service login nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'outbox_publisher') then
        create role outbox_publisher login nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'app_reader') then
        create role app_reader login nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'app_backup') then
        create role app_backup login nosuperuser nocreatedb nocreaterole bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'readonly_reporter') then
        create role readonly_reporter nologin nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
    end $$;
  `);
  const setPassword = async (role: LoginRole, password: string) => {
    if (!rotatePasswords && existing.has(role)) return;
    const escaped = password.replaceAll("'", "''");
    await sql.unsafe(`alter role ${role} with password '${escaped}'`);
  };
  await setPassword('app_user', passwords.appUser);
  await setPassword('auth_service', passwords.authService);
  await setPassword('outbox_publisher', passwords.outboxPublisher);
  if (passwords.appReader !== undefined) await setPassword('app_reader', passwords.appReader);
  if (passwords.appBackup !== undefined) await setPassword('app_backup', passwords.appBackup);
  for (const role of LOGIN_ROLES) {
    await sql.unsafe(`alter role ${role} nobypassrls`);
    // A stuck request must not hold a transaction, and with it a document-sequence row lock, open.
    await sql.unsafe(`alter role ${role} set statement_timeout = '30s'`);
    await sql.unsafe(`alter role ${role} set lock_timeout = '10s'`);
    await sql.unsafe(`alter role ${role} set idle_in_transaction_session_timeout = '30s'`);
  }
  // The reader's every transaction is read-only, whatever a caller asks for.
  await sql.unsafe(`alter role app_reader set default_transaction_read_only = on`);
  // The backup reads past the policies (as created above; Supabase refuses a statement that names
  // the superuser attribute, so `backupRoleProblems()` reads the attributes back instead). Its
  // sessions start read-only, a default a session may change; its grants are select only. Two
  // sessions at most (a copy and a spare), a limit the login itself cannot raise.
  await sql.unsafe(`alter role app_backup set default_transaction_read_only = on`);
  await sql.unsafe(`alter role app_backup connection limit ${String(BACKUP_CONNECTION_LIMIT)}`);
}

/** How many sessions `app_backup` may hold at once. */
export const BACKUP_CONNECTION_LIMIT = 2;

/**
 * What is wrong with `app_backup`, read back from the catalogue (empty when it is as
 * `ensureRoles()` makes it). A role made earlier by hand keeps its attributes, and a role granted
 * `app_backup` would read past every policy through it, so the migrator stops on either. Only the
 * migrator's own grant, which `create role` gives it with neither SET nor INHERIT, may name the
 * role. A read needs no ALTER, so Supabase's `supautils` has nothing to refuse.
 */
export async function backupRoleProblems(sql: postgres.ISql): Promise<string[]> {
  const [role] = await sql<
    {
      login: boolean;
      bypass: boolean;
      superuser: boolean;
      createrole: boolean;
      createdb: boolean;
      replication: boolean;
      limit: number;
    }[]
  >`
    select rolcanlogin as login, rolbypassrls as bypass, rolsuper as superuser,
           rolcreaterole as createrole, rolcreatedb as createdb, rolreplication as replication,
           rolconnlimit as limit
      from pg_roles where rolname = 'app_backup'`;
  if (role === undefined) return ['app_backup does not exist'];
  const problems: string[] = [];
  if (!role.login) problems.push('app_backup cannot log in');
  if (!role.bypass) problems.push('app_backup lacks bypassrls, so a copy would miss rows');
  for (const attribute of ['superuser', 'createrole', 'createdb', 'replication'] as const) {
    if (role[attribute]) problems.push(`app_backup has ${attribute}`);
  }
  if (role.limit !== BACKUP_CONNECTION_LIMIT) {
    problems.push(
      `app_backup's connection limit is ${String(role.limit)}, not ${String(BACKUP_CONNECTION_LIMIT)}`,
    );
  }
  const members = await sql<{ member: string; own: boolean; usable: boolean }[]>`
    select m.member::regrole::text as member, m.member = r.oid as own,
           m.inherit_option or m.set_option as usable
      from pg_auth_members m, (select oid from pg_roles where rolname = current_user) r
     where m.roleid = 'app_backup'::regrole`;
  for (const m of members) {
    if (!m.own || m.usable) problems.push(`${m.member} is a member of app_backup`);
  }
  const [memberOf] = await sql<{ count: number }[]>`
    select count(*)::int as count from pg_auth_members where member = 'app_backup'::regrole`;
  if ((memberOf?.count ?? 0) > 0) problems.push('app_backup is a member of another role');
  return problems;
}

async function assertBackupRole(sql: postgres.Sql): Promise<void> {
  const problems = await backupRoleProblems(sql);
  if (problems.length > 0) throw new Error(`app_backup is not as made:\n${problems.join('\n')}`);
}

/**
 * Every migration on disk is applied, with the text it has now (AUDIT M22). Drizzle records the
 * SHA-256 of each file it applies; a file edited afterwards, or one it skipped because it sorts
 * before the last applied, has no matching row.
 */
async function assertAllApplied(sql: postgres.Sql): Promise<void> {
  const entries = readJournal(migrationsFolder);
  const problems = journalProblems(
    entries,
    new Set(readdirSync(migrationsFolder).filter((f) => f.endsWith('.sql'))),
  );
  const applied = new Set(
    (await sql<{ hash: string }[]>`select hash from drizzle.__drizzle_migrations`).map(
      (r) => r.hash,
    ),
  );
  for (const entry of entries) {
    if (!applied.has(migrationHash(migrationsFolder, entry.tag))) {
      problems.push(`${entry.tag}: not applied as it is on disk (edited after it ran, or skipped)`);
    }
  }
  if (problems.length > 0) throw new Error(`migrations do not match:\n${problems.join('\n')}`);
}

/**
 * Applies the migrations once, even when two deploys start together (an advisory lock), and
 * gives up on a table lock held by live traffic after 10 s instead of queueing every request
 * behind it. A migration that builds an index `concurrently` cannot run in the migrator's
 * transaction; it is applied by hand first, as docs/runbooks/deploy.md describes.
 */
export async function runMigrations(
  options: { rotatePasswords?: boolean; verifyOnly?: boolean } = {},
): Promise<void> {
  const url = requireEnv('DATABASE_URL_MIGRATOR');
  const sql = postgres(url, {
    ...connectionOptions(url, 'shakti-migrate'),
    max: 1,
    prepare: false,
  });
  try {
    await assertOwnerBypassesRls(sql);
    if (options.verifyOnly === true) {
      await assertAllApplied(sql);
      await assertBackupRole(sql);
      return;
    }
    await sql`select pg_advisory_lock(hashtext('shakti.migrate'))`;
    try {
      await sql`set lock_timeout = '10s'`;
      await ensureRoles(
        sql,
        {
          appUser: requireEnv('APP_USER_PASSWORD'),
          authService: requireEnv('AUTH_SERVICE_PASSWORD'),
          outboxPublisher: requireEnv('OUTBOX_PUBLISHER_PASSWORD'),
          appReader: optionalEnv('APP_READER_PASSWORD'),
          appBackup: optionalEnv('APP_BACKUP_PASSWORD'),
        },
        options.rotatePasswords ?? false,
      );
      await assertBackupRole(sql);
      await migrate(drizzle(sql), { migrationsFolder });
      await assertAllApplied(sql);
    } finally {
      await sql`select pg_advisory_unlock(hashtext('shakti.migrate'))`;
    }
  } finally {
    await sql.end();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const verifyOnly = process.argv.includes('--verify');
  await runMigrations({ rotatePasswords: process.argv.includes('--rotate-passwords'), verifyOnly });
  console.log(
    verifyOnly ? 'db: every migration is applied as it is on disk' : 'db: migrations applied',
  );
}
