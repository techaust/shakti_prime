import { newId, type ReadyChecks } from '@shakti/contracts';
import { checkDatabaseReady, probeReady } from '@shakti/db';
import { checkAuthDatabaseReady } from '@shakti/db/auth';
import { defaultAuthDeps, hostedRuntime, productionConfigProblems } from './deps';

/**
 * Readiness of everything a request needs (AUDIT M8). The key-value check writes and reads back
 * a probe key, so a store that answers but returns the wrong thing (AUDIT C1) is caught too.
 */
export async function checkReadiness(): Promise<ReadyChecks> {
  const config = hostedRuntime() && productionConfigProblems().length > 0 ? 'down' : 'ok';
  const [database, authDatabase, keyValue] = await Promise.all([
    checkDatabaseReady(),
    checkAuthDatabaseReady(),
    config === 'ok' ? probeReady(keyValueRoundTrip) : Promise.resolve('down' as const),
  ]);
  return { database, auth_database: authDatabase, key_value: keyValue, config };
}

async function keyValueRoundTrip(): Promise<void> {
  const store = defaultAuthDeps().keyValue;
  const key = `ready:${newId()}`;
  const value = newId();
  await store.set(key, value, 30);
  const read = await store.get(key);
  await store.del(key);
  if (read !== value) throw new Error('the key-value store did not return what was written');
}
