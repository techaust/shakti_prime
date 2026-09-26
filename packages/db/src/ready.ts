import { sql } from 'drizzle-orm';
import { rawDb } from './client';

/** Readiness probe for `/api/v1/health/ready`: a round trip as `app_user`, no table touched. */
export async function checkDatabaseReady(timeoutMs = 3_000): Promise<'ok' | 'down'> {
  const probe = rawDb()
    .execute(sql`select 1`)
    .then(() => 'ok' as const);
  const timeout = new Promise<'down'>((resolveTimeout) => {
    setTimeout(() => {
      resolveTimeout('down');
    }, timeoutMs).unref();
  });
  try {
    return await Promise.race([probe, timeout]);
  } catch {
    return 'down';
  }
}
