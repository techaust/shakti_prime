// The auth module's connection: the non-superuser `auth_service`, which may touch the identity
// tables only (docs/DATABASE.md §3). Better Auth's Drizzle adapter and the session bookkeeping in
// apps/web/src/auth are its only callers; importing it anywhere else is a lint error.
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireEnv } from './env';
import { probeReady } from './ready';
import { authAccounts, authVerifications, sessions, users, userTwoFactor } from './schema/identity';

/** Keys are the Better Auth model names the adapter looks up (`user.modelName` and friends). */
export const authSchema = {
  users,
  sessions,
  auth_accounts: authAccounts,
  auth_verifications: authVerifications,
  user_two_factor: userTwoFactor,
} as const;

let pool: ReturnType<typeof postgres> | undefined;

function authSqlClient(): ReturnType<typeof postgres> {
  pool ??= postgres(requireEnv('DATABASE_URL_AUTH'), {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return pool;
}

export type AuthDb = ReturnType<typeof createAuthDb>;

function createAuthDb() {
  return drizzle(authSqlClient(), { schema: authSchema });
}

let db: AuthDb | undefined;

export function authDb(): AuthDb {
  db ??= createAuthDb();
  return db;
}

/** Readiness probe for the auth module's connection (AUDIT M8). */
export function checkAuthDatabaseReady(timeoutMs = 3_000): Promise<'ok' | 'down'> {
  return probeReady(() => authDb().execute(sql`select 1`), timeoutMs);
}

export async function closeAuthDb(): Promise<void> {
  if (pool) await pool.end({ timeout: 5 });
  pool = undefined;
  db = undefined;
}
