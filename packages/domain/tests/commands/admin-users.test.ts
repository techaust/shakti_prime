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
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { resolvePrincipalFromGrants } from '../../src/auth/resolve-principal';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
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

/** Waits until a transaction is queued on an advisory lock, the admin changes' serialising lock. */
async function waitForLockWaiter(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const [row] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
    );
    if ((row?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no change queued on the lock');
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
          { context, audit, outbox },
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
          { context, audit, outbox },
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
          { context, audit, outbox },
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
          { context, audit, outbox },
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
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const address = email();
    const dto = await asPrincipal(exec, (context) =>
      runCommand(
        inviteUser,
        { context, audit: recorded, outbox: emitted },
        {
          email: ` ${address.toUpperCase()} `,
          displayName: 'Ravi Kumar',
          phone: '+919811100001',
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
      theme: 'system',
      twoFactorEnabled: false,
      lastLoginAt: null,
      entityRoles: [
        { entityId: 1, roleKey: 'accounts', teamId: null },
        { entityId: 3, roleKey: 'general_manager', teamId: null },
      ],
    });
    expect(Object.keys(dto)).not.toContain('password');
    expect(recorded.records).toContainEqual(
      expect.objectContaining({ command: 'admin.user.invite' }),
    );
    expect(emitted.records).toEqual([
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
  it('role.set, suspend, reactivate and session revoke are denied for a General Manager', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const session = await addSession(user.id);
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(
          setUserRoles,
          { context, audit, outbox },
          { userId: user.id, entityRoles: [{ entityId: 1, roleKey: 'accounts' }] },
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(suspendUser, { context, audit, outbox }, { userId: user.id }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(reactivateUser, { context, audit, outbox }, { userId: user.id }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(revokeSession, { context, audit, outbox }, { sessionId: session }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await revokedIds(user.id)).toEqual([]);
  });

  it('role.set refuses a scope that does not cover every entity the user holds, and self changes', async () => {
    const exec1 = await createTestPrincipal('executive', [1]);
    const user = await createTestUser([
      { entityId: 1, roleKey: 'tele_caller_cc' },
      { entityId: 2, roleKey: 'accounts' },
    ]);
    // Narrowed to entity 1, the Executive would silently drop the entity-2 role: refused instead.
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(
          setUserRoles,
          { context, audit, outbox },
          { userId: user.id, entityRoles: [{ entityId: 1, roleKey: 'store_manager' }] },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'user_roles_outside_scope', entityIds: [2] },
    });
    const untouched = await loadUserGrants(user.id);
    expect(new Set(untouched.map((r) => r.entityId))).toEqual(new Set([1, 2]));

    // Naming an entity outside the scope in the new list is refused the same way as invite.
    const local = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(
          setUserRoles,
          { context, audit, outbox },
          { userId: local.id, entityRoles: [{ entityId: 2, roleKey: 'accounts' }] },
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'entity_outside_scope' } });

    const exec = await createTestPrincipal('executive');
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          setUserRoles,
          { context, audit, outbox },
          { userId: exec.id, entityRoles: [{ entityId: 1, roleKey: 'accounts' }] },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'self_role_change' } });
  });

  it('role.set checks the scope after the lock, so a role given in another company meanwhile survives', async () => {
    const exec1 = await createTestPrincipal('executive', [1]);
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    let pending: Promise<unknown> | undefined;
    // Another change holds the lock and gives the user a company-2 role; the narrowed Executive's
    // change waits for it, then sees the new role and is refused instead of removing it.
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext('admin.executives'))`;
        await tx`insert into user_entity_roles (id, user_id, entity_id, role_id)
          values (${newId()}, ${user.id}, 2, (select id from roles where key = 'accounts'))`;
        pending = asPrincipal(exec1, (context) =>
          runCommand(
            setUserRoles,
            { context, audit, outbox },
            { userId: user.id, entityRoles: [{ entityId: 1, roleKey: 'store_manager' }] },
          ),
        ).catch((e: unknown) => e);
        await waitForLockWaiter();
      }),
    );
    expect(await pending).toMatchObject({
      code: 'conflict',
      details: { reason: 'user_roles_outside_scope', entityIds: [2] },
    });
    const roles = await asMigrator(
      (m) => m<{ entity_id: number; key: string }[]>`
        select uer.entity_id, r.key from user_entity_roles uer join roles r on r.id = uer.role_id
         where uer.user_id = ${user.id} order by uer.entity_id`,
    );
    expect(roles).toEqual([
      { entity_id: 1, key: 'tele_caller_cc' },
      { entity_id: 2, key: 'accounts' },
    ]);
  });

  it('replaces the roles, revokes every live session and the next resolution sees the new grants', async () => {
    const exec = await createTestPrincipal('executive');
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const s1 = await addSession(user.id);
    const s2 = await addSession(user.id);

    const dto = await asPrincipal(exec, (context) =>
      runCommand(
        setUserRoles,
        { context, audit, outbox },
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
        runCommand(suspendUser, { context, audit, outbox }, { userId: exec.id, reason: 'self' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'self_suspend' } });

    const suspended = await asPrincipal(exec, (context) =>
      runCommand(
        suspendUser,
        { context, audit, outbox },
        { userId: user.id, reason: 'left the company' },
      ),
    );
    expect(suspended.status).toBe('suspended');
    expect(await revokedIds(user.id)).toEqual([s1]);
    expect(resolvePrincipalFromGrants(user.id, await loadUserGrants(user.id))).toMatchObject({
      kind: 'inactive',
      status: 'suspended',
    });
    // a repeated suspend (a double click) answers the current record and revokes nothing more
    const again = await asPrincipal(exec, (context) =>
      runCommand(suspendUser, { context, audit, outbox }, { userId: user.id }),
    );
    expect(again.status).toBe('suspended');
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(suspendUser, { context, audit, outbox }, { userId: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'user_missing' } });

    const back = await asPrincipal(exec, (context) =>
      runCommand(reactivateUser, { context, audit, outbox }, { userId: user.id }),
    );
    expect(back.status).toBe('active');
    const backAgain = await asPrincipal(exec, (context) =>
      runCommand(reactivateUser, { context, audit, outbox }, { userId: user.id }),
    );
    expect(backAgain.status).toBe('active');
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
      runCommand(revokeSession, { context, audit, outbox }, { sessionId: s1 }),
    );
    expect(result).toEqual({ userId: user.id, revokedSessionIds: [s1] });
    expect(await revokedIds(user.id)).toEqual([s1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(revokeSession, { context, audit, outbox }, { sessionId: s1 }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'session_missing' } });

    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(revokeSession, { context, audit, outbox }, { sessionId: s2 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('admin commands stay inside the request scope (AUDIT H2)', () => {
  it('an Executive acting for one company cannot suspend, reactivate or sign out someone who also works in another', async () => {
    const exec1 = await createTestPrincipal('executive', [1]);
    const both = await createTestUser([
      { entityId: 1, roleKey: 'tele_caller_cc' },
      { entityId: 2, roleKey: 'tele_caller_cc' },
    ]);
    const session = await addSession(both.id);
    const outside = { code: 'conflict', details: { reason: 'user_roles_outside_scope' } };

    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(suspendUser, { context, audit, outbox }, { userId: both.id }),
      ),
    ).rejects.toMatchObject(outside);
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(revokeSession, { context, audit, outbox }, { sessionId: session }),
      ),
    ).rejects.toMatchObject(outside);
    await asMigrator((m) => m`update users set status = 'suspended' where id = ${both.id}`);
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(reactivateUser, { context, audit, outbox }, { userId: both.id }),
      ),
    ).rejects.toMatchObject(outside);
    expect(await revokedIds(both.id)).toEqual([]);

    // someone who works only in that company is in scope
    const onlyOne = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
    const suspended = await asPrincipal(exec1, (context) =>
      runCommand(suspendUser, { context, audit, outbox }, { userId: onlyOne.id }),
    );
    expect(suspended.status).toBe('suspended');
  });

  it('refuses a suspension or demotion that would leave no active Executive (AUDIT L7)', async () => {
    const exec = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'executive' }]);
    // In one transaction, suspend every other active Executive, then act on the last one. The
    // refusal rolls the whole transaction back, so the shared database is untouched.
    const suspendOthers = sql`update users set status = 'suspended'
      where status = 'active' and id <> ${target.id} and id in (
        select uer.user_id from user_entity_roles uer
        join roles r on r.id = uer.role_id where r.key = 'executive')`;
    const lastExecutive = { code: 'conflict', details: { reason: 'last_executive' } };

    await expect(
      asPrincipal(exec, async (context) => {
        await context.tx.execute(suspendOthers);
        return runCommand(suspendUser, { context, audit, outbox }, { userId: target.id });
      }),
    ).rejects.toMatchObject(lastExecutive);
    await expect(
      asPrincipal(exec, async (context) => {
        await context.tx.execute(suspendOthers);
        return runCommand(
          setUserRoles,
          { context, audit, outbox },
          { userId: target.id, entityRoles: [{ entityId: 1, roleKey: 'accounts' }] },
        );
      }),
    ).rejects.toMatchObject(lastExecutive);

    const [row] = await asMigrator(
      (m) => m<{ status: string }[]>`select status from users where id = ${target.id}`,
    );
    expect(row?.status).toBe('active');
  });

  it('counts the Executives of every company for an Executive narrowed to one company (0049)', async () => {
    const exec1 = await createTestPrincipal('executive', [1]);
    const target = await createTestUser([{ entityId: 1, roleKey: 'executive' }]);
    const elsewhere = await createTestUser([{ entityId: 2, roleKey: 'executive' }]);
    const demote = {
      userId: target.id,
      entityRoles: [{ entityId: 1, roleKey: 'accounts' as const }],
    };
    const rollback = new Error('rollback');

    // The only other active Executive works in company 2, which this request cannot read: the
    // guard still counts them, so the demotion goes through (and is rolled back here).
    await expect(
      asPrincipal(exec1, async (context) => {
        await context.tx.execute(sql`update users set status = 'suspended'
          where status = 'active' and id not in (${target.id}, ${elsewhere.id})`);
        await runCommand(setUserRoles, { context, audit, outbox }, demote);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    // With no other active Executive anywhere, the same demotion is refused.
    await expect(
      asPrincipal(exec1, async (context) => {
        await context.tx.execute(sql`update users set status = 'suspended'
          where status = 'active' and id <> ${target.id}`);
        return runCommand(setUserRoles, { context, audit, outbox }, demote);
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'last_executive' } });
  });
});
