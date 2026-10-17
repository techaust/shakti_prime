import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import {
  newBackupPassword,
  poolerAddress,
  PRODUCTION_PROJECT_REF,
  scramVerifier,
  setBackupVerifier,
} from '../../src/backup-login';
import { requireEnv } from '../../src/env';
import { asMigrator, closeDb } from '../../src/testing/index';

// The backup login's password (docs/runbooks/deploy.md §1 step 4): the owner's script gives the
// database only its SCRAM verifier, and the login then signs in with the password alone.

afterAll(closeDb);

/** The local database's address, signed in as app_backup with this password. */
function asBackup(password: string): string {
  const url = new URL(requireEnv('DATABASE_URL_MIGRATOR'));
  url.username = 'app_backup';
  url.password = encodeURIComponent(password);
  return url.toString();
}

describe("the backup login's password", () => {
  it('is kept as a verifier that signs in with the password and with nothing else', async () => {
    const password = newBackupPassword();
    expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const verifier = scramVerifier(password);
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(verifier).not.toContain(password);
    try {
      await asMigrator((m) => setBackupVerifier(m, verifier));
      const backup = postgres(asBackup(password), { max: 1, connect_timeout: 10 });
      try {
        const [row] = await backup<{ who: string; readOnly: string }[]>`
          select current_user as who, current_setting('transaction_read_only') as "readOnly"`;
        expect(row).toEqual({ who: 'app_backup', readOnly: 'on' });
      } finally {
        await backup.end();
      }
      const wrong = postgres(asBackup(newBackupPassword()), { max: 1, connect_timeout: 10 });
      try {
        await expect(wrong`select 1`).rejects.toThrow(/password authentication failed/);
      } finally {
        await wrong.end();
      }
    } finally {
      // Locally the login keeps no password, as the migrations make it.
      await asMigrator((m) => m`alter role app_backup with password null`);
    }
  });

  it('refuses a plain password, which would reach the server and its log', async () => {
    await expect(asMigrator((m) => setBackupVerifier(m, newBackupPassword()))).rejects.toThrow(
      'not a SCRAM-SHA-256 verifier',
    );
    await expect(
      asMigrator((m) => setBackupVerifier(m, "SCRAM-SHA-256$4096:a$b:c'; drop table x; --")),
    ).rejects.toThrow('not a SCRAM-SHA-256 verifier');
    expect(() => scramVerifier('pass word')).toThrow('printable ASCII');
  });

  it("builds only the production project's Mumbai session pooler address", () => {
    expect(poolerAddress('app_backup', 'aws-1-ap-south-1.pooler.supabase.com', 'a/b:c@d')).toBe(
      `postgresql://app_backup.${PRODUCTION_PROJECT_REF}:a%2Fb%3Ac%40d@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
    );
    for (const host of [
      `db.${PRODUCTION_PROJECT_REF}.supabase.co`,
      'aws-1-us-east-1.pooler.supabase.com',
      'aws-1-ap-south-1.pooler.supabase.com.example.in',
    ]) {
      expect(() => poolerAddress('app_backup', host, 'value')).toThrow('session pooler in Mumbai');
    }
  });
});
