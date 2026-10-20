import { describe, expect, it } from 'vitest';
import { DemoTargetRefused, demoTarget, PRODUCTION_PROJECT_REF } from './demo-data-target';

const STAGING = 'abcdefghijklmnopqrst';
const pooler = (role: string, ref: string) =>
  `postgresql://${role}.${ref}:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`;

const local = {
  DATABASE_URL: 'postgres://app_user:pw@127.0.0.1:54322/postgres',
  DATABASE_URL_AUTH: 'postgres://auth_service:pw@localhost:54322/postgres',
  DATABASE_URL_MIGRATOR: 'postgres://postgres:pw@127.0.0.1:54322/postgres',
};

const hosted = (ref: string) => ({
  DATABASE_URL: pooler('app_user', ref),
  DATABASE_URL_AUTH: pooler('auth_service', ref),
  DATABASE_URL_OUTBOX: pooler('outbox_publisher', ref),
});

function refusal(env: Record<string, string | undefined>, ref?: string): string {
  try {
    demoTarget(env, ref);
  } catch (error) {
    expect(error).toBeInstanceOf(DemoTargetRefused);
    return (error as Error).message;
  }
  throw new Error('the target was not refused');
}

describe('demoTarget', () => {
  it('refuses production by its project ref, in any address, even with every other sign of staging', () => {
    expect(
      refusal({ ...hosted(PRODUCTION_PROJECT_REF), BOS_ENVIRONMENT: 'staging' }, STAGING),
    ).toMatch(/production project/);
    expect(
      refusal(
        {
          ...hosted(STAGING),
          DATABASE_URL_MIGRATOR: `postgresql://postgres:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
          BOS_ENVIRONMENT: 'staging',
        },
        STAGING,
      ),
    ).toMatch(/DATABASE_URL_MIGRATOR names the production project/);
    expect(
      refusal(
        { ...hosted(PRODUCTION_PROJECT_REF), BOS_ENVIRONMENT: 'staging' },
        PRODUCTION_PROJECT_REF,
      ),
    ).toMatch(/production project/);
  });

  it('refuses BOS_ENVIRONMENT=production, even on a local database', () => {
    expect(refusal({ ...local, BOS_ENVIRONMENT: 'production' })).toMatch(/production/);
    expect(refusal({ ...hosted(STAGING), BOS_ENVIRONMENT: 'production' }, STAGING)).toMatch(
      /production/,
    );
  });

  it('allows a database on this machine', () => {
    expect(demoTarget(local, undefined)).toEqual({ kind: 'local' });
    expect(demoTarget({ ...local, BOS_ENVIRONMENT: 'local' }, undefined)).toEqual({
      kind: 'local',
    });
  });

  it('allows the staging project only when it is named and every address is on it', () => {
    expect(demoTarget({ ...hosted(STAGING), BOS_ENVIRONMENT: 'staging' }, STAGING)).toEqual({
      kind: 'staging',
      projectRef: STAGING,
    });
    expect(refusal({ ...hosted(STAGING), BOS_ENVIRONMENT: 'staging' })).toMatch(/--staging-ref/);
    expect(refusal({ ...hosted(STAGING) }, STAGING)).toMatch(/not staging/);
    expect(refusal({ ...hosted(STAGING), BOS_ENVIRONMENT: 'dev' }, STAGING)).toMatch(/not staging/);
    expect(
      refusal(
        {
          ...hosted(STAGING),
          DATABASE_URL_AUTH: pooler('auth_service', 'zyxwvutsrqponmlkjihg'),
          BOS_ENVIRONMENT: 'staging',
        },
        STAGING,
      ),
    ).toMatch(/DATABASE_URL_AUTH is not an address of the project/);
  });

  it('refuses any other host, a mix of local and remote, and an address it cannot read', () => {
    expect(
      refusal(
        {
          DATABASE_URL: 'postgres://app_user:pw@db.example.net:5432/postgres',
          DATABASE_URL_AUTH: 'postgres://auth_service:pw@db.example.net:5432/postgres',
          BOS_ENVIRONMENT: 'staging',
        },
        STAGING,
      ),
    ).toMatch(/not an address of the project/);
    expect(refusal({ ...local, DATABASE_URL_AUTH: pooler('auth_service', STAGING) })).toMatch(
      /Some database addresses/,
    );
    expect(refusal({ ...local, DATABASE_URL: 'not an address' })).toMatch(/cannot be read/);
  });

  it('needs the application and auth addresses', () => {
    expect(refusal({ DATABASE_URL: local.DATABASE_URL })).toMatch(/DATABASE_URL_AUTH is not set/);
    expect(refusal({})).toMatch(/DATABASE_URL is not set/);
  });
});
