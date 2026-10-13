import { sql } from 'drizzle-orm';
import { rawDb, readerConfigured, readerDb } from './client';

/**
 * Runs a readiness probe with a time limit: `down` on an error or when it takes too long. A probe
 * that fails before it starts (a connection string that is not set) is `down` too, not a 500
 * without an envelope (AUDIT L11).
 */
export async function probeReady(
  run: () => Promise<unknown>,
  timeoutMs = 3_000,
): Promise<'ok' | 'down'> {
  const timeout = new Promise<'down'>((resolveTimeout) => {
    setTimeout(() => {
      resolveTimeout('down');
    }, timeoutMs).unref();
  });
  try {
    const probe = run().then(() => 'ok' as const);
    return await Promise.race([probe, timeout]);
  } catch {
    return 'down';
  }
}

/** Readiness probe for `/api/v1/health/ready`: a round trip as `app_user`, no table touched. */
export function checkDatabaseReady(timeoutMs = 3_000): Promise<'ok' | 'down'> {
  return probeReady(() => rawDb().execute(sql`select 1`), timeoutMs);
}

/**
 * Readiness of the queries' `app_reader` pool (audit 2026-10, OPS-9): a round trip as that role
 * when `DATABASE_URL_READER` is set, since every `executeQuery()` then reads there, and `ok`
 * when it is not, as the queries read on `app_user` then. A reader whose password no longer
 * matches after a rotation turns readiness down instead of failing every screen unseen.
 */
export function checkReaderReady(timeoutMs = 3_000): Promise<'ok' | 'down'> {
  if (!readerConfigured()) return Promise.resolve('ok');
  return probeReady(() => readerDb().execute(sql`select 1`), timeoutMs);
}
