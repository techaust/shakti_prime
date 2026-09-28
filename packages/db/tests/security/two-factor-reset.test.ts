import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

async function enrolledUser(
  entityRoles: Parameters<typeof createTestUser>[0] = [{ entityId: 1, roleKey: 'accounts' }],
): Promise<string> {
  const user = await createTestUser(entityRoles, { twoFactorEnabled: true });
  await asMigrator(
    (m) => m`insert into user_two_factor (id, user_id, secret, backup_codes)
             values (${newId()}, ${user.id}, 'sealed', 'sealed')`,
  );
  return user.id;
}

async function state(userId: string): Promise<{ enabled: boolean; apps: number } | undefined> {
  const [row] = await asMigrator(
    (m) => m<{ enabled: boolean; apps: number }[]>`
      select u.two_factor_enabled as enabled,
             (select count(*)::int from user_two_factor t where t.user_id = u.id) as apps
        from users u where u.id = ${userId}`,
  );
  return row;
}

function reset(principal: Principal, userId: string) {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select app.reset_two_factor(${userId}::uuid) as was`,
    )) as unknown as { was: boolean }[];
    return rows[0]?.was;
  });
}

describe('app.reset_two_factor() is the only request path to the two-factor store', () => {
  it('only the application role may call it', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.reset_two_factor(uuid)', 'execute') as app,
             has_function_privilege('auth_service', 'app.reset_two_factor(uuid)', 'execute') as auth,
             has_function_privilege('outbox_publisher', 'app.reset_two_factor(uuid)', 'execute') as outbox,
             has_function_privilege('readonly_reporter', 'app.reset_two_factor(uuid)', 'execute') as reporter,
             has_function_privilege('public', 'app.reset_two_factor(uuid)', 'execute') as pub
    `);
    expect(row).toEqual({ app: true, auth: false, outbox: false, reporter: false, pub: false });
  });

  it('refuses a caller without the Executive permission, and with no context at all', async () => {
    const userId = await enrolledUser();
    const gm = await createTestPrincipal('general_manager', [1]);
    expect(await failure(reset(gm, userId))).toMatch(/admin\.users\.write:all is required/);
    expect(
      await failure(withoutContext(sql`select app.reset_two_factor(${userId}::uuid)`)),
    ).toMatch(/admin\.users\.write:all is required/);
    expect(await state(userId)).toEqual({ enabled: true, apps: 1 });
  });

  it('refuses the caller’s own account', async () => {
    const exec = await createTestPrincipal('executive');
    expect(await failure(reset(exec, exec.id))).toMatch(/own authenticator app/);
  });

  it('lets an Executive remove another user’s app and answers whether one was enrolled', async () => {
    const exec = await createTestPrincipal('executive');
    const userId = await enrolledUser();
    expect(await reset(exec, userId)).toBe(true);
    expect(await state(userId)).toEqual({ enabled: false, apps: 0 });
    expect(await reset(exec, userId)).toBe(false);
    expect(await reset(exec, newId())).toBe(false);
  });

  it('keeps to the request’s companies: a person who also works elsewhere needs an administrator acting there too (0059)', async () => {
    const userId = await enrolledUser([
      { entityId: 1, roleKey: 'accounts' },
      { entityId: 2, roleKey: 'tele_caller_cc' },
    ]);
    const exec1 = await createTestPrincipal('executive', [1]);
    expect(await failure(reset(exec1, userId))).toMatch(/outside the request/);
    expect(await state(userId)).toEqual({ enabled: true, apps: 1 });
    // Acting for both companies the person works in, or for all of them, the reset goes through.
    const exec12 = await createTestPrincipal('executive', [1, 2]);
    expect(await reset(exec12, userId)).toBe(true);
    expect(await state(userId)).toEqual({ enabled: false, apps: 0 });
    const other = await enrolledUser([
      { entityId: 1, roleKey: 'accounts' },
      { entityId: 2, roleKey: 'tele_caller_cc' },
    ]);
    expect(await reset(await createTestPrincipal('executive'), other)).toBe(true);
  });

  it('a person with no role is changed only by an administrator acting for the whole group (0059)', async () => {
    const userId = await enrolledUser([]);
    for (const ids of [[1], [1, 2, 3]]) {
      const exec = await createTestPrincipal('executive', ids);
      expect(await failure(reset(exec, userId)), ids.join()).toMatch(/outside the request/);
    }
    expect(await state(userId)).toEqual({ enabled: true, apps: 1 });
    expect(await reset(await createTestPrincipal('executive'), userId)).toBe(true);
  });

  it('leaves the application role without any privilege on the store itself', async () => {
    const exec = await createTestPrincipal('executive');
    const userId = await enrolledUser();
    expect(
      await failure(
        asPrincipal(exec, ({ tx }) =>
          tx.execute(sql`delete from user_two_factor where user_id = ${userId}`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        asPrincipal(exec, ({ tx }) =>
          tx.execute(sql`update users set two_factor_enabled = false where id = ${userId}`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(await state(userId)).toEqual({ enabled: true, apps: 1 });
  });
});
