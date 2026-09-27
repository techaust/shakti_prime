import type { Options } from 'postgres';

/** A database on this machine or in the CI service container; everything else is hosted. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);

export function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Connection options shared by every pool (AUDIT M11). A hosted database is reached over TLS
 * that verifies the server against the CA in `DATABASE_CA_CERT` (Supabase signs with its own
 * root, which no system store holds); without that certificate a hosted connection is refused
 * rather than opened unverified. `application_name` names the pool in `pg_stat_activity`.
 */
export function connectionOptions(
  url: string,
  applicationName: string,
  env: NodeJS.ProcessEnv = process.env,
): Pick<Options<Record<string, never>>, 'ssl' | 'connection'> {
  const connection = { application_name: applicationName };
  if (isLocalDatabase(url)) return { ssl: false, connection };
  const ca = env.DATABASE_CA_CERT;
  if (ca === undefined || ca.trim() === '') {
    throw new Error(
      'DATABASE_CA_CERT is not set: a hosted database is reached only over verified TLS',
    );
  }
  return { ssl: { ca, rejectUnauthorized: true }, connection };
}
