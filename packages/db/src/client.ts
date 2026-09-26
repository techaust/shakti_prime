// The only module that opens application connections. It runs as the non-superuser `app_user`,
// so every query is subject to RLS. Importing it outside packages/db is a lint error; all other
// code goes through withRequestContext() (CLAUDE.md, ADR 0002, ADR 0004).
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireEnv } from './env';
import * as schema from './schema/index';

let pool: ReturnType<typeof postgres> | undefined;

export function sqlClient(): ReturnType<typeof postgres> {
  pool ??= postgres(requireEnv('DATABASE_URL'), {
    // Supavisor transaction mode: no prepared statements, modest pool (docs/DATABASE.md §1).
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return pool;
}

export type Db = ReturnType<typeof createDb>;

function createDb() {
  return drizzle(sqlClient(), { schema });
}

let db: Db | undefined;

export function rawDb(): Db {
  db ??= createDb();
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end({ timeout: 5 });
  pool = undefined;
  db = undefined;
}
