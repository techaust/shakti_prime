import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestUser,
  principalFor,
  type TestUser,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listUserSessions, listUsers } from '../../src/queries/admin/list-users';
import { encodeCursor } from '../../src/queries/parse-input';

afterAll(closeDb);

// Names sort by a random prefix of this run, so the paging checks read only this run's people.
const tag = `zz-admin-lists-${newId().slice(-8)}`;
let inBoth: TestUser;
let onlyTwo: TestUser;
let third: TestUser;
const liveSession = newId();
const endedSession = newId();

beforeAll(async () => {
  inBoth = await createTestUser(
    [
      { entityId: 1, roleKey: 'accounts' },
      { entityId: 2, roleKey: 'store_manager' },
    ],
    { name: `${tag} a` },
  );
  onlyTwo = await createTestUser([{ entityId: 2, roleKey: 'field_engineer' }], {
    name: `${tag} b`,
  });
  third = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }], {
    name: `${tag} c`,
  });
  await asMigrator(
    (
      m,
    ) => m`insert into sessions (id, user_id, token, expires_at, ip_address, user_agent, revoked_at, revoked_reason, created_at)
      values (${liveSession}, ${inBoth.id}, ${`t-${liveSession}`}, now() + interval '1 day', '203.0.113.9', 'Firefox', null, null, now()),
             (${endedSession}, ${inBoth.id}, ${`t-${endedSession}`}, now() + interval '1 day', null, null, now(), 'admin', now() - interval '1 hour')`,
  );
});

// A position just before this run's names, so the paging reads this run's people only.
const start = encodeCursor({ s: 'name.asc', v: tag, id: newId() });

/** Every page of the list from the first person of this run on. */
async function mine(entityIds: number[], limit = 2) {
  const out: string[] = [];
  let cursor = start;
  for (;;) {
    const page = await asPrincipal(principalFor('executive', entityIds), (ctx) =>
      listUsers(ctx, { limit, cursor }),
    );
    const ours = page.items.filter((u) => u.displayName.startsWith(tag));
    out.push(...ours.map((u) => u.id));
    if (page.nextCursor === null || ours.length < page.items.length) return out;
    cursor = page.nextCursor;
  }
}

describe('listUsers', () => {
  it('is refused without admin.users.write at group scope, before any row is read', async () => {
    for (const role of ['general_manager', 'accounts', 'tele_caller_cc'] as const) {
      await expect(
        asPrincipal(principalFor(role, [1]), (ctx) => listUsers(ctx, {})),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('lists everyone with a role in the companies of the request, by name, page by page', async () => {
    expect(await mine([1, 2, 3, 4])).toEqual([inBoth.id, onlyTwo.id, third.id]);
    expect(await mine([1])).toEqual([inBoth.id, third.id]);
    expect(await mine([2], 1)).toEqual([inBoth.id, onlyTwo.id]);
  });

  it('answers each person with their roles and no secret', async () => {
    const page = await asPrincipal(principalFor('executive'), (ctx) =>
      listUsers(ctx, { limit: 3, cursor: start }),
    );
    const found = page.items.find((u) => u.id === inBoth.id);
    expect(found?.entityRoles).toEqual([
      { entityId: 1, roleKey: 'accounts', teamId: null },
      { entityId: 2, roleKey: 'store_manager', teamId: null },
    ]);
    expect(Object.keys(found ?? {}).sort()).toEqual([
      'displayName',
      'email',
      'entityRoles',
      'id',
      'lastLoginAt',
      'phone',
      'status',
      'theme',
      'twoFactorEnabled',
      'updatedAt',
    ]);
  });

  it('refuses a cursor it did not make', async () => {
    await expect(
      asPrincipal(principalFor('executive'), (ctx) => listUsers(ctx, { cursor: 'bm90LWpzb24' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('listUserSessions', () => {
  it('is refused without admin.users.write at group scope', async () => {
    await expect(
      asPrincipal(principalFor('general_manager', [1]), (ctx) =>
        listUserSessions(ctx, { userId: inBoth.id }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists a person’s sign-ins newest first, ended ones with their reason, never the key', async () => {
    const sessions = await asPrincipal(principalFor('executive'), (ctx) =>
      listUserSessions(ctx, { userId: inBoth.id }),
    );
    expect(sessions.map((s) => s.id)).toEqual([liveSession, endedSession]);
    expect(sessions[0]).toMatchObject({ ipAddress: '203.0.113.9', revokedAt: null });
    expect(sessions[1]).toMatchObject({ revokedReason: 'admin' });
    expect(Object.keys(sessions[0] ?? {})).not.toContain('token');
  });
});
