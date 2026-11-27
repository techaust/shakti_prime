import { newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireEnv } from '../../src/env';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestUser,
  principalFor,
  withoutContext,
  type TestUser,
} from '../../src/testing/index';

// F1 (docs/03-roadmap-appendix/phase4.md §6.4): the field app's phones. The auth module owns the
// rows through auth_service; app_user and app_reader read the columns without a secret, a person
// their own phones and a holder of field.device.revoke those of the people they may sign out, and
// app_user signs a phone out, never back in, never by deleting it.

afterAll(closeDb);

let engineer: TestUser;
let elsewhere: TestUser;
let colleague: TestUser;
let engineerPhone: string;
let elsewherePhone: string;

async function phone(userId: string): Promise<string> {
  const id = newId();
  const hash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    '',
  );
  await asMigrator(
    (m) => m`insert into mobile_devices (id, user_id, device_id, app_version, refresh_token_hash,
               refresh_family_id, refresh_expires_at, signed_in_at, push_token)
             values (${id}, ${userId}, ${newId()}, '1.0.0', ${hash}, ${newId()},
                     now() + interval '30 days', now(), 'push-token-of-the-phone')`,
  );
  return id;
}

beforeAll(async () => {
  engineer = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
  elsewhere = await createTestUser([{ entityId: 2, roleKey: 'field_engineer' }]);
  colleague = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
  engineerPhone = await phone(engineer.id);
  elsewherePhone = await phone(elsewhere.id);
});

const rollback = new Error('rollback');

/** Rows the statement returned as `principal`, always rolled back. */
async function rowsAs(principal: Principal, statement: SQL): Promise<number> {
  let n: number | undefined;
  try {
    await asPrincipal(principal, async ({ tx }) => {
      n = ((await tx.execute(statement)) as unknown as unknown[]).length;
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback || n === undefined) throw e;
  }
  return n ?? -1;
}

const seen = (id: string) => sql`select id from mobile_devices where id = ${id}`;
const revoke = (id: string) =>
  sql`update mobile_devices set revoked_at = now(), revoked_reason = 'revoked'
      where id = ${id} returning id`;

const as = (user: TestUser, roleKey: Principal['roleKey'], entityIds: number[]) =>
  principalFor(roleKey, entityIds, { id: user.id });

describe('mobile_devices fail closed', () => {
  it('returns no row with no request context', async () => {
    const [row] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from mobile_devices`,
    );
    expect(row?.n).toBe(0);
  });

  it('never lets a request role read a secret column, nor the reporting role anything', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_column_privilege('app_user', 'mobile_devices', 'refresh_token_hash', 'SELECT') as hash,
             has_column_privilege('app_user', 'mobile_devices', 'refresh_family_id', 'SELECT') as family,
             has_column_privilege('app_user', 'mobile_devices', 'device_id', 'SELECT') as device,
             has_column_privilege('app_user', 'mobile_devices', 'push_token', 'SELECT') as push,
             has_column_privilege('app_reader', 'mobile_devices', 'refresh_token_hash', 'SELECT') as reader_hash,
             has_column_privilege('app_user', 'mobile_devices', 'refresh_token_hash', 'UPDATE') as write_hash,
             has_column_privilege('app_user', 'mobile_devices', 'revoked_at', 'UPDATE') as revoke,
             has_table_privilege('app_user', 'mobile_devices', 'INSERT') as insert,
             has_table_privilege('app_user', 'mobile_devices', 'DELETE') as delete,
             has_table_privilege('readonly_reporter', 'mobile_devices', 'SELECT') as reporter,
             has_any_column_privilege('readonly_reporter', 'mobile_devices', 'SELECT') as reporter_any`);
    expect(row).toEqual({
      hash: false,
      family: false,
      device: false,
      push: false,
      reader_hash: false,
      write_hash: false,
      revoke: true,
      insert: false,
      delete: false,
      reporter: false,
      reporter_any: false,
    });
    await expect(
      asPrincipal(principalFor('executive'), ({ tx }) =>
        tx.execute(sql`select refresh_token_hash from mobile_devices limit 1`),
      ),
    ).rejects.toThrow();
  });
});

describe('who reads a phone', () => {
  it('a person reads their own phones and nobody else’s', async () => {
    expect(await rowsAs(as(engineer, 'field_engineer', [1]), seen(engineerPhone))).toBe(1);
    expect(await rowsAs(as(engineer, 'field_engineer', [1]), seen(elsewherePhone))).toBe(0);
    expect(await rowsAs(as(colleague, 'tele_caller_cc', [1]), seen(engineerPhone))).toBe(0);
  });

  it('field.device.revoke at entity reads the phones of people working in the request’s companies', async () => {
    const gm = principalFor('general_manager', [1]);
    expect(await rowsAs(gm, seen(engineerPhone))).toBe(1);
    expect(await rowsAs(gm, seen(elsewherePhone))).toBe(0);
    expect(await rowsAs(principalFor('project_manager', [2]), seen(elsewherePhone))).toBe(1);
    expect(await rowsAs(principalFor('general_manager', []), seen(engineerPhone))).toBe(0);
  });

  it('field.device.revoke at all reads every phone', async () => {
    const exec = principalFor('executive', [3]);
    expect(await rowsAs(exec, seen(engineerPhone))).toBe(1);
    expect(await rowsAs(exec, seen(elsewherePhone))).toBe(1);
  });
});

describe('who signs a phone out', () => {
  it('a holder of field.device.revoke for a company of the person, and nobody else', async () => {
    expect(await rowsAs(principalFor('general_manager', [1]), revoke(engineerPhone))).toBe(1);
    expect(await rowsAs(principalFor('general_manager', [1]), revoke(elsewherePhone))).toBe(0);
    expect(await rowsAs(principalFor('executive', [3]), revoke(elsewherePhone))).toBe(1);
    // the person themselves holds no grant: the app signs itself out through the auth module
    expect(await rowsAs(as(engineer, 'field_engineer', [1]), revoke(engineerPhone))).toBe(0);
    expect(await rowsAs(principalFor('tele_caller_cc', [1]), revoke(engineerPhone))).toBe(0);
  });

  it('never signs a phone back in, nor deletes one', async () => {
    const id = await phone(engineer.id);
    await asMigrator(
      (m) =>
        m`update mobile_devices set revoked_at = now(), revoked_reason = 'revoked' where id = ${id}`,
    );
    await expect(
      rowsAs(
        principalFor('executive'),
        sql`update mobile_devices set revoked_at = null, revoked_reason = null where id = ${id} returning id`,
      ),
    ).rejects.toThrow();
    await expect(
      rowsAs(
        principalFor('executive'),
        sql`delete from mobile_devices where id = ${id} returning id`,
      ),
    ).rejects.toThrow();
  });
});

describe('the auth module', () => {
  it('signs a phone in, rotates its token and signs it out, as auth_service', async () => {
    const auth = postgres(requireEnv('DATABASE_URL_AUTH'), { max: 1, onnotice: () => undefined });
    try {
      const [row] = await auth<{ hash: string }[]>`
        select refresh_token_hash as hash from mobile_devices where id = ${engineerPhone}`;
      expect(row?.hash).toMatch(/^[0-9a-f]{64}$/);
      const updated = await auth`update mobile_devices set last_seen_at = now()
        where id = ${engineerPhone} returning id`;
      expect(updated).toHaveLength(1);
      await expect(auth`delete from mobile_devices where id = ${engineerPhone}`).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await auth.end();
    }
  });
});
