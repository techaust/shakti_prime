import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the repo-root .env for local scripts and tests. Hosted environments set real variables.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) config({ path: rootEnv, quiet: true });
else if (existsSync(resolve(process.cwd(), '.env'))) config({ quiet: true });

export function requireEnv(
  name:
    | 'DATABASE_URL'
    | 'DATABASE_URL_MIGRATOR'
    | 'DATABASE_URL_AUTH'
    | 'DATABASE_URL_OUTBOX'
    | 'DATABASE_URL_READER'
    | 'APP_USER_PASSWORD'
    | 'AUTH_SERVICE_PASSWORD'
    | 'OUTBOX_PUBLISHER_PASSWORD'
    | 'APP_READER_PASSWORD',
): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. Copy .env.example to .env or set it in the environment.`);
  }
  return value;
}

/**
 * A variable the app runs without: `DATABASE_URL_READER` (the queries then read on `app_user` in a
 * read-only transaction) and `APP_READER_PASSWORD` (the role `app_reader` then has no password).
 */
export function optionalEnv(
  name: 'DATABASE_URL_READER' | 'APP_READER_PASSWORD',
): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}
