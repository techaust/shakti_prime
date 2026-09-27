// Applies migrations as the table owner (docs/DATABASE.md §3, §8). Application code never runs this.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { connectionOptions } from './connection';
import { requireEnv } from './env';
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

const LOGIN_ROLES = ['app_user', 'auth_service', 'outbox_publisher'] as const;
type LoginRole = (typeof LOGIN_ROLES)[number];

/**
 * `app_user`, `auth_service`, `outbox_publisher` and `readonly_reporter` are cluster roles, so
 * they are created here, not in SQL files. `auth_service` is the auth module's connection: it may
 * touch the identity tables only; `outbox_publisher` delivers `outbox_events` and touches nothing
 * else (docs/DATABASE.md §3). A password is set when the role is created and again only
 * on `--rotate-passwords`, so the statement text does not land in the server log on every run.
 */
async function ensureRoles(
  sql: postgres.Sql,
  passwords: { appUser: string; authService: string; outboxPublisher: string },
  rotatePasswords: boolean,
): Promise<void> {
  const before = await sql<{ rolname: string }[]>`
    select rolname from pg_roles where rolname in ('app_user', 'auth_service', 'outbox_publisher', 'readonly_reporter')`;
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
  for (const role of LOGIN_ROLES) {
    await sql.unsafe(`alter role ${role} nobypassrls`);
    // A stuck request must not hold a transaction, and with it a document-sequence row lock, open.
    await sql.unsafe(`alter role ${role} set statement_timeout = '30s'`);
    await sql.unsafe(`alter role ${role} set lock_timeout = '10s'`);
    await sql.unsafe(`alter role ${role} set idle_in_transaction_session_timeout = '30s'`);
  }
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
 * transaction; it is applied by hand first, as docs/runbooks/DEPLOY.md describes.
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
        },
        options.rotatePasswords ?? false,
      );
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
