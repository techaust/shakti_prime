// Applies migrations as the table owner (docs/DATABASE.md §3, §8). Application code never runs this.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { requireEnv } from './env';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** `app_user` and `readonly_reporter` are cluster roles, so they are created here, not in SQL files. */
async function ensureRoles(sql: postgres.Sql, appUserPassword: string): Promise<void> {
  await sql.unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'app_user') then
        create role app_user login nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'readonly_reporter') then
        create role readonly_reporter nologin nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
    end $$;
  `);
  const escaped = appUserPassword.replaceAll("'", "''");
  await sql.unsafe(`alter role app_user with password '${escaped}' nobypassrls`);
  // A stuck request must not hold a transaction, and with it a document-sequence row lock, open.
  await sql.unsafe(`alter role app_user set statement_timeout = '30s'`);
  await sql.unsafe(`alter role app_user set lock_timeout = '10s'`);
  await sql.unsafe(`alter role app_user set idle_in_transaction_session_timeout = '30s'`);
}

export async function runMigrations(): Promise<void> {
  const sql = postgres(requireEnv('DATABASE_URL_MIGRATOR'), { max: 1, prepare: false });
  try {
    await ensureRoles(sql, requireEnv('APP_USER_PASSWORD'));
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  await runMigrations();
  console.log('db: migrations applied');
}
