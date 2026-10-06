// The only module that opens application connections. It runs as the non-superuser `app_user`,
// so every query is subject to RLS, and, when `DATABASE_URL_READER` is set, a second pool runs as
// `app_reader`, which may only select, under the same policies. Importing it outside packages/db
// is a lint error; all other code goes through withRequestContext() (CLAUDE.md, ADR 0002, ADR
// 0004).
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { connectionOptions } from './connection';
import { optionalEnv, requireEnv } from './env';
import * as schema from './schema/index';

let pool: ReturnType<typeof postgres> | undefined;

export function sqlClient(): ReturnType<typeof postgres> {
  const url = requireEnv('DATABASE_URL');
  pool ??= postgres(url, {
    ...connectionOptions(url, 'shakti-app'),
    // Supavisor transaction mode: no prepared statements, modest pool (docs/05-database.md §1).
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

let readerPool: ReturnType<typeof postgres> | undefined;
let reader: Db | undefined;

/** Whether the queries have their own `app_reader` pool (docs/05-database.md §3). */
export function readerConfigured(): boolean {
  return optionalEnv('DATABASE_URL_READER') !== undefined;
}

/**
 * The `app_reader` pool, opened on first use like the application's. Its role reads only, and
 * every transaction on it is read-only by the role's own setting.
 */
export function readerDb(): Db {
  const url = optionalEnv('DATABASE_URL_READER');
  if (url === undefined) throw new Error('DATABASE_URL_READER is not set.');
  readerPool ??= postgres(url, {
    ...connectionOptions(url, 'shakti-reader'),
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  reader ??= drizzle(readerPool, { schema });
  return reader;
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end({ timeout: 5 });
  if (readerPool) await readerPool.end({ timeout: 5 });
  pool = undefined;
  db = undefined;
  readerPool = undefined;
  reader = undefined;
}
