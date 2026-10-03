import { isPlatformOnlyPermission, PERMISSION_KEYS, STAFF_ROLE_KEYS } from '@shakti/contracts';
import {
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  grantsForRole,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { roleGrantsVersion } from '../../src/commands/admin/role-grants-version';
import { getRoleGrants, listRoles } from '../../src/queries/admin/roles';

afterAll(closeDb);

describe('listRoles and getRoleGrants', () => {
  it('are refused for a General Manager and for an agent', async () => {
    // Reads write nothing, so the callers need no principal row (an agent row would add to the
    // seeded agent principals the fail-closed suite counts).
    for (const key of ['general_manager', 'hr_admin', 'agent:chief'] as const) {
      const caller = principalFor(key);
      await expect(asPrincipal(caller, (ctx) => listRoles(ctx))).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(
        asPrincipal(caller, (ctx) => getRoleGrants(ctx, { roleKey: 'accounts' })),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('lists every staff role in order with its grants and the people holding it', async () => {
    const exec = await createTestPrincipal('executive');
    const before = await asPrincipal(exec, (ctx) => listRoles(ctx));
    expect(before.roles.map((r) => r.key)).toEqual([...STAFF_ROLE_KEYS]);
    const field = before.roles.find((r) => r.key === 'field_engineer');
    expect(field?.grantCount).toBe(grantsForRole('field_engineer').length);

    await createTestUser([
      { entityId: 1, roleKey: 'field_engineer' },
      { entityId: 2, roleKey: 'field_engineer' },
    ]);
    await createTestUser([{ entityId: 3, roleKey: 'field_engineer' }]);
    const after = await asPrincipal(exec, (ctx) => listRoles(ctx));
    const counted = after.roles.find((r) => r.key === 'field_engineer');
    // one person holding it in two companies counts once
    expect(counted?.holderCount).toBe((field?.holderCount ?? 0) + 2);

    // a request for one company counts the people holding the role there
    const inOne = await asPrincipal(await createTestPrincipal('executive', [3]), (ctx) =>
      listRoles(ctx),
    );
    expect(inOne.roles.find((r) => r.key === 'field_engineer')?.holderCount).toBeLessThan(
      counted?.holderCount ?? 0,
    );
  });

  it('answers the whole staff catalogue in order with the role scope or none', async () => {
    const exec = await createTestPrincipal('executive');
    const page = await asPrincipal(exec, (ctx) =>
      getRoleGrants(ctx, { roleKey: 'tele_caller_cc' }),
    );
    expect(page.role.key).toBe('tele_caller_cc');
    // A platform-only permission is held by the platform's workers alone and never listed.
    expect(page.permissions.map((p) => p.key)).toEqual(
      PERMISSION_KEYS.filter((key) => !isPlatformOnlyPermission(key)),
    );
    const granted = Object.fromEntries(
      grantsForRole('tele_caller_cc').map((g) => [g.key, g.scope]),
    );
    for (const p of page.permissions) {
      expect(p.scope, p.key).toBe(granted[p.key] ?? null);
      expect(p.module).toBe(p.key.split('.')[0]);
    }
    expect(page.version).toBe(
      roleGrantsVersion(
        grantsForRole('tele_caller_cc').map((g) => ({ permission: g.key, scope: g.scope })),
      ),
    );
    expect(page.groupScope).toBe(true);
    const byKey = Object.fromEntries(page.permissions.map((p) => [p.key, p]));
    expect(byKey['finance.cost.read']).toMatchObject({ locked: 'costHolders', scopes: [] });
    expect(byKey['admin.users.write']).toMatchObject({ locked: 'executiveOnly', scopes: [] });
    expect(byKey['pricing.read']).toMatchObject({ locked: null, scopes: ['entity', 'all'] });
  });

  it('locks the admin grants the Executive role keeps and names a narrowed request', async () => {
    const page = await asPrincipal(await createTestPrincipal('executive', [2]), (ctx) =>
      getRoleGrants(ctx, { roleKey: 'executive' }),
    );
    expect(page.groupScope).toBe(false);
    const byKey = Object.fromEntries(page.permissions.map((p) => [p.key, p]));
    expect(byKey['admin.roles.write']).toMatchObject({ locked: 'executiveKeeps', scopes: ['all'] });
    expect(byKey['admin.flags.write']).toMatchObject({ locked: null, scopes: ['all'] });
    expect(byKey['finance.cost.read']).toMatchObject({ locked: null, scopes: ['entity', 'all'] });
  });

  it('refuses an agent role key as input', async () => {
    const exec = await createTestPrincipal('executive');
    await expect(
      asPrincipal(exec, (ctx) => getRoleGrants(ctx, { roleKey: 'agent:triage' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
