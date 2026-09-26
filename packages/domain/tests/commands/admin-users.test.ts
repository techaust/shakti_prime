import { newId } from '@shakti/contracts';
import { loadUserGrants } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolvePrincipalFromGrants } from '../../src/auth/resolve-principal';
import { runCommand } from '../../src/command/run-command';
import { inviteUser } from '../../src/commands/admin/invite-user';
import { revokeSession } from '../../src/commands/admin/revoke-session';
import { setUserRoles } from '../../src/commands/admin/set-user-roles';
import { reactivateUser, suspendUser } from '../../src/commands/admin/user-status';

afterAll(closeDb);

const email = () => `invite-${newId().slice(-12)}@shakti.test`;

/** A live session row for a user, written by the auth module's owner in real life. */
async function addSession(userId: string): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into sessions (id, user_id, token, expires_at)
      values (${id}, ${userId}, ${`tok-${id}`}, now() + interval '12 hours')`,
  );
  return id;
}

async function revokedIds(userId: string): Promise<string[]> {
  const rows = await asMigrator(
    (m) =>
      m<
        { id: string }[]
      >`select id from sessions where user_id = ${userId} and revoked_at is not null order by id`,
  );
  return rows.map((r) => r.id);
}

describe('admin.user.invite', () => {
  it('is denied for a General Manager and for an Executive scoped to one entity', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(
          inviteUser,
          { context },
          {
            email: email(),
            displayName: 'Ravi',
            entityRoles: [{ entityId: 1, roleKey: 'accounts' }],
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const exec1 = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(
          inviteUser,
          { context },
          {
            email: email(),
            displayName: 'Ravi',
            entityRoles: [{ entityId: 2, roleKey: 'accounts' }],
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'entity_outside_scope' } });
  });

  it('refuses a taken email, an unknown team and a team of another entity', async () => {
    const exec = await createTestPrincipal('executive');
    const existing = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          inviteUser,
          { context },
          {
            email: existing.email.toUpperCase(),
            displayName: 'Dup',
            entityRoles: [{ entityId: 1, roleKey: 'accounts' }],
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'invite_email_taken' } });

    const team2 = await createTestTeam(2, 'entity two team');
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          inviteUser,
          { context },
          {
            email: email(),
            displayName: 'Ravi',
            entityRoles: [{ entityId: 1, roleKey: 'tele_caller_cc', teamId: team2 }],
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'team_missing' } });
  });

  it('creates the principal, the invited user and one role per entity, then audits and emits', async () => {
    const exec = await createTestPrincipal('executive');
    const onAudit = vi.fn();
    const onEmit = vi.fn();
    const address = email();
    const dto = await asPrincipal(exec, (context) =>
      runCommand(
        inviteUser,
        { context, onAudit, onEmit },
        {
          email: ` ${address.toUpperCase()} `,
          displayName: 'Ravi Kumar',
          phone: '+919811100001',
          locale: 'hi',
          entityRoles: [
            { entityId: 1, roleKey: 'accounts' },
            { entityId: 3, roleKey: 'general_manager' },
          ],
        },
      ),
    );
    expect(dto).toMatchObject({
      email: address,
      displayName: 'Ravi Kumar',
      status: 'invited',
      locale: 'hi',
      theme: 'system',
      twoFactorEnabled: false,
      lastLoginAt: null,
      entityRoles: [
        { entityId: 1, roleKey: 'accounts', teamId: null },
        { entityId: 3, roleKey: 'general_manager', teamId: null },
      ],
    });
    expect(Object.keys(dto)).not.toContain('password');
    expect(onAudit).toHaveBeenCalledWith(expect.objectContaining({ command: 'admin.user.invite' }));
    expect(onEmit).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'admin.user.invited', entityId: 1 }),
      expect.objectContaining({ type: 'admin.user.invited', entityId: 3 }),
    ]);
    const [principal] = await asMigrator(
      (m) => m<{ kind: string }[]>`select kind from principals where id = ${dto.id}`,
    );
    expect(principal?.kind).toBe('user');
  });
});

describe('admin.user.role.set, suspend, reactivate and session revoke', () => {
  it('replaces the roles, revokes every live session and the next resolution sees the new grants', async () => {
    const exec = await createTestPrincipal('executive');
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const s1 = await addSession(user.id);
    const s2 = await addSession(user.id);

    const dto = await asPrincipal(exec, (context) =>
      runCommand(
        setUserRoles,
        { context },
        {
          userId: user.id,
          entityRoles: [
            { entityId: 2, roleKey: 'accounts' },
            { entityId: 4, roleKey: 'store_manager' },
          ],
        },
      ),
    );
    expect(dto.entityRoles.map((r) => [r.entityId, r.roleKey])).toEqual([
      [2, 'accounts'],
      [4, 'store_manager'],
    ]);
    expect(await revokedIds(user.id)).toEqual([s1, s2].sort());

    const outcome = resolvePrincipalFromGrants(user.id, await loadUserGrants(user.id));
    expect(outcome.kind).toBe('totp_required');
    const single = resolvePrincipalFromGrants(user.id, await loadUserGrants(user.id), 4);
    expect(single.kind).toBe('totp_required');
  });

  it('a user with mixed roles resolves to the intersection in all-entities mode', async () => {
    const user = await createTestUser(
      [
        { entityId: 1, roleKey: 'sales_team_lead' },
        { entityId: 2, roleKey: 'tele_caller_cc' },
      ],
      { twoFactorEnabled: true },
    );
    const outcome = resolvePrincipalFromGrants(user.id, await loadUserGrants(user.id));
    expect(outcome.kind).toBe('principal');
    if (outcome.kind !== 'principal') return;
    expect(outcome.principal.entityIds).toEqual([1, 2]);
    const read = outcome.principal.permissions.find((g) => g.key === 'crm.lead.read');
    expect(read?.scope).toBe('own');
    expect(outcome.principal.permissions.some((g) => g.key === 'crm.lead.assign')).toBe(false);
    expect(outcome.principal.roleKey).toBe('tele_caller_cc');
  });

  it('suspend revokes sessions and blocks resolution; reactivate restores it', async () => {
    const exec = await createTestPrincipal('executive');
    const user = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
    const s1 = await addSession(user.id);

    await expect(
      asPrincipal(exec, (context) =>
        runCommand(suspendUser, { context }, { userId: exec.id, reason: 'self' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'self_suspend' } });

    const suspended = await asPrincipal(exec, (context) =>
      runCommand(suspendUser, { context }, { userId: user.id, reason: 'left the company' }),
    );
    expect(suspended.status).toBe('suspended');
    expect(await revokedIds(user.id)).toEqual([s1]);
    expect(resolvePrincipalFromGrants(user.id, await loadUserGrants(user.id))).toEqual({
      kind: 'inactive',
      status: 'suspended',
    });
    await expect(
      asPrincipal(exec, (context) => runCommand(suspendUser, { context }, { userId: user.id })),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'user_missing' } });

    const back = await asPrincipal(exec, (context) =>
      runCommand(reactivateUser, { context }, { userId: user.id }),
    );
    expect(back.status).toBe('active');
    expect(resolvePrincipalFromGrants(user.id, await loadUserGrants(user.id)).kind).toBe(
      'principal',
    );
  });

  it('revokes one session and reports a missing or already revoked one as not found', async () => {
    const exec = await createTestPrincipal('executive');
    const user = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
    const s1 = await addSession(user.id);
    const s2 = await addSession(user.id);

    const result = await asPrincipal(exec, (context) =>
      runCommand(revokeSession, { context }, { sessionId: s1 }),
    );
    expect(result).toEqual({ userId: user.id, revokedSessionIds: [s1] });
    expect(await revokedIds(user.id)).toEqual([s1]);
    await expect(
      asPrincipal(exec, (context) => runCommand(revokeSession, { context }, { sessionId: s1 })),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'session_missing' } });

    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) => runCommand(revokeSession, { context }, { sessionId: s2 })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
