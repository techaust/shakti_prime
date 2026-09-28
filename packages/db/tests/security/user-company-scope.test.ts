import { newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestUser,
  principalFor,
  type TestUser,
} from '../../src/testing/index';

// users and sessions belong to no single company, so a change to either reaches every company
// the person works in. Since 0056 their update policies ask what the admin commands ask
// (assertUserInScope, AUDIT H2): the person holds no role outside the request's companies.

afterAll(closeDb);

let both: TestUser;
let onlyOne: TestUser;
let bothSession: string;
let onlyOneSession: string;

async function newSession(userId: string): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into sessions (id, user_id, token, expires_at)
      values (${id}, ${userId}, ${`tok-${id}`}, now() + interval '1 hour')`,
  );
  return id;
}

beforeAll(async () => {
  both = await createTestUser([
    { entityId: 1, roleKey: 'accounts' },
    { entityId: 2, roleKey: 'tele_caller_cc' },
  ]);
  onlyOne = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
  bothSession = await newSession(both.id);
  onlyOneSession = await newSession(onlyOne.id);
});

const rollback = new Error('rollback');

/** Rows the statement changed as `principal`, always rolled back. */
async function changed(principal: Principal, statement: SQL): Promise<number> {
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

const suspend = (userId: string) =>
  sql`update users set status = 'suspended' where id = ${userId} returning id`;
const rename = (userId: string) =>
  sql`update users set name = 'renamed in a test' where id = ${userId} returning id`;
const revoke = (sessionId: string) =>
  sql`update sessions set revoked_at = now(), revoked_reason = 'admin'
       where id = ${sessionId} and revoked_at is null returning id`;

describe('users and sessions are written for the companies of the request only (0056)', () => {
  it('an administrator acting for company 1 cannot suspend, or sign out, someone who also works in company 2', async () => {
    const exec1 = principalFor('executive', [1]);
    expect(await changed(exec1, suspend(both.id))).toBe(0);
    expect(await changed(exec1, rename(both.id))).toBe(0);
    expect(await changed(exec1, revoke(bothSession))).toBe(0);
    // Someone who works in company 1 alone is theirs to change.
    expect(await changed(exec1, suspend(onlyOne.id))).toBe(1);
    expect(await changed(exec1, revoke(onlyOneSession))).toBe(1);
  });

  it('acting for every company the person works in, or for all companies, can', async () => {
    for (const exec of [principalFor('executive', [1, 2]), principalFor('executive')]) {
      expect(await changed(exec, suspend(both.id))).toBe(1);
      expect(await changed(exec, revoke(bothSession))).toBe(1);
    }
  });

  it('a caller without admin.users.write is refused as before, with no error', async () => {
    const gm = principalFor('general_manager', [1, 2]);
    expect(await changed(gm, suspend(onlyOne.id))).toBe(0);
    expect(await changed(gm, revoke(onlyOneSession))).toBe(0);
    const self = principalFor('accounts', [1], { id: onlyOne.id });
    expect(await changed(self, rename(onlyOne.id))).toBe(0);
    expect(await changed(self, revoke(onlyOneSession))).toBe(0);
  });

  it('own-row paths still work: an administrator’s own row, and the theme and contrast definers', async () => {
    const admin = await createTestUser([
      { entityId: 1, roleKey: 'executive' },
      { entityId: 2, roleKey: 'executive' },
    ]);
    const adminSession = await newSession(admin.id);
    const self = principalFor('executive', [1], { id: admin.id });
    expect(await changed(self, rename(admin.id))).toBe(1);
    expect(await changed(self, revoke(adminSession))).toBe(1);

    const worker = principalFor('accounts', [1], { id: both.id });
    const saved = await asPrincipal(worker, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select app.set_own_theme('dark') as theme, app.set_own_contrast('high') as contrast`,
      )) as unknown as { theme: string; contrast: string }[];
      await tx.execute(sql`select app.set_own_theme('system'), app.set_own_contrast('standard')`);
      return rows[0];
    });
    expect(saved).toEqual({ theme: 'dark', contrast: 'high' });
  });
});
