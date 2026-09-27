import { describe, expect, it } from 'vitest';
import { connectionOptions, isLocalDatabase } from './connection';

// Shaped like real connection strings; none holds a real credential.
const local = 'postgres://app_user:local@127.0.0.1:54322/postgres';
const hosted =
  'postgres://app_user.project:value@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

describe('database connections (AUDIT M11)', () => {
  it('treats this machine and the CI container as local', () => {
    expect(isLocalDatabase(local)).toBe(true);
    expect(isLocalDatabase('postgres://u:p@localhost/db')).toBe(true);
    expect(isLocalDatabase('postgres://u:p@postgres:5432/db')).toBe(true);
    expect(isLocalDatabase(hosted)).toBe(false);
  });

  it('connects locally without TLS, and names the pool', () => {
    expect(connectionOptions(local, 'shakti-app', {})).toEqual({
      ssl: false,
      connection: { application_name: 'shakti-app' },
    });
  });

  it('verifies a hosted server against the configured CA, and refuses without one', () => {
    expect(connectionOptions(hosted, 'shakti-auth', { DATABASE_CA_CERT: 'PEM' })).toEqual({
      ssl: { ca: 'PEM', rejectUnauthorized: true },
      connection: { application_name: 'shakti-auth' },
    });
    expect(() => connectionOptions(hosted, 'shakti-auth', {})).toThrow(/DATABASE_CA_CERT/);
  });
});
