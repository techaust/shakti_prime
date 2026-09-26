// Applies migrations as the table owner (docs/DATABASE.md §3, §8). Application code never runs this.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { requireEnv } from './env';

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

/**
 * `app_user`, `auth_service` and `readonly_reporter` are cluster roles, so they are created here,
 * not in SQL files. `auth_service` is the auth module's connection: it may touch the identity
 * tables only (docs/DATABASE.md §3). A password is set when the role is created and again only
 * on `--rotate-passwords`, so the statement text does not land in the server log on every run.
 */
async function ensureRoles(
  sql: postgres.Sql,
  passwords: { appUser: string; authService: string },
  rotatePasswords: boolean,
): Promise<void> {
  const before = await sql<{ rolname: string }[]>`
    select rolname from pg_roles where rolname in ('app_user', 'auth_service', 'readonly_reporter')`;
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
      if not exists (select 1 from pg_roles where rolname = 'readonly_reporter') then
        create role readonly_reporter nologin nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
    end $$;
  `);
  const setPassword = async (role: 'app_user' | 'auth_service', password: string) => {
    if (!rotatePasswords && existing.has(role)) return;
    const escaped = password.replaceAll("'", "''");
    await sql.unsafe(`alter role ${role} with password '${escaped}'`);
  };
  await setPassword('app_user', passwords.appUser);
  await setPassword('auth_service', passwords.authService);
  for (const role of ['app_user', 'auth_service'] as const) {
    await sql.unsafe(`alter role ${role} nobypassrls`);
    // A stuck request must not hold a transaction, and with it a document-sequence row lock, open.
    await sql.unsafe(`alter role ${role} set statement_timeout = '30s'`);
    await sql.unsafe(`alter role ${role} set lock_timeout = '10s'`);
    await sql.unsafe(`alter role ${role} set idle_in_transaction_session_timeout = '30s'`);
  }
}

export async function runMigrations(options: { rotatePasswords?: boolean } = {}): Promise<void> {
  const sql = postgres(requireEnv('DATABASE_URL_MIGRATOR'), { max: 1, prepare: false });
  try {
    await assertOwnerBypassesRls(sql);
    await ensureRoles(
      sql,
      {
        appUser: requireEnv('APP_USER_PASSWORD'),
        authService: requireEnv('AUTH_SERVICE_PASSWORD'),
      },
      options.rotatePasswords ?? false,
    );
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  await runMigrations({ rotatePasswords: process.argv.includes('--rotate-passwords') });
  console.log('db: migrations applied');
}
