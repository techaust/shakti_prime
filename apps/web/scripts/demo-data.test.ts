import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_PROJECT_REF } from './demo-data-target';

// The command line itself: the target is decided before the first query. The addresses name the
// production project on hosts under `.invalid`, which never resolve, so even a script that tried
// to connect could reach nothing; it must stop at the guard, before it looks for the Executive.
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(env: Record<string, string>) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('DATABASE_URL')),
  );
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/demo-data.ts', 'load'], {
    cwd: webRoot,
    env: { ...clean, ...env } as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('scripts/demo-data.ts', () => {
  it('refuses a production address before it opens any connection', () => {
    const address = (role: string) =>
      `postgresql://${role}:pw@db.${PRODUCTION_PROJECT_REF}.invalid:5432/postgres`;
    const result = run({
      DATABASE_URL: address('app_user'),
      DATABASE_URL_AUTH: address('auth_service'),
      DATABASE_URL_MIGRATOR: address('postgres'),
      DATABASE_URL_OUTBOX: address('outbox_publisher'),
      DATABASE_URL_READER: address('app_reader'),
      BOS_ENVIRONMENT: 'staging',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused: DATABASE_URL names the production project/);
    expect(result.stdout).not.toMatch(/acting as/);
    // A connection attempt would have failed on the address instead.
    expect(result.stderr).not.toMatch(/ENOTFOUND|getaddrinfo|ECONNREFUSED/);
  }, 60_000);
});
