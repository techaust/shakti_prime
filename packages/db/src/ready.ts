import { sql } from 'drizzle-orm';
import { rawDb } from './client';

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
