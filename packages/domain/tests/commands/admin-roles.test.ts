import { newId, STAFF_ROLE_KEYS, type RoleGrantInput } from '@shakti/contracts';
import {
  ALL_ENTITY_IDS,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  grantsForRole,
  roleId,
  runSeeds,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import { runCommand } from '../../src/command/run-command';
import { setRolePermissions } from '../../src/commands/admin/set-role-permissions';

afterAll(closeDb);

/** The role the happy paths edit; each test puts it back as the seed has it. */
const EDITED = 'hr_admin' as const;

const seeded = (key: (typeof STAFF_ROLE_KEYS)[number]): RoleGrantInput[] =>
  grantsForRole(key).map((g) => ({ permission: g.key, scope: g.scope }));

async function addSession(userId: string): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into sessions (id, user_id, token, expires_at)
      values (${id}, ${userId}, ${`tok-${id}`}, now() + interval '12 hours')`,
  );
  return id;
}

async function sessionState(ids: readonly string[]): Promise<Record<string, string | null>> {
  const rows = await asMigrator(
    (m) => m<{ id: string; reason: string | null }[]>`
      select id, revoked_reason as reason from sessions where id in ${m(ids)}`,
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.reason]));
}

async function grantsOf(key: string): Promise<string[]> {
  const rows = await asMigrator(
    (m) => m<{ g: string }[]>`
      select permission_key || ':' || scope as g from role_permissions
       where role_id = ${roleId(key as 'hr_admin')} order by 1`,
  );
  return rows.map((r) => r.g);
}

async function customisedAt(key: string): Promise<Date | null> {
  const [row] = await asMigrator(
    (m) => m<{ at: Date | null }[]>`
      select customised_at as at from roles where id = ${roleId(key as 'hr_admin')}`,
  );
  return row?.at ?? null;
}

/** Puts a role back as the seed has it: not customised, then the seed restores its grants. */
async function restore(key: string): Promise<void> {
  await asMigrator(
    (m) => m`update roles set customised_at = null where id = ${roleId(key as 'hr_admin')}`,
  );
  await runSeeds();
}

const edited = (): RoleGrantInput[] => [
  // hr.export removed, hr.employee.write narrowed from all, pricing.read added
  ...seeded(EDITED)
    .filter((g) => g.permission !== 'hr.export')
    .map((g) =>
      g.permission === 'hr.employee.write' ? { ...g, scope: 'entity' as const } : g,
    ),
  { permission: 'pricing.read', scope: 'entity' },
];

describe('admin.role.permissions.set: who may change a role', () => {
  it('is denied for a General Manager and every other staff role but Executive', async () => {
    for (const key of STAFF_ROLE_KEYS.filter((k) => k !== 'executive')) {
      const caller = await createTestPrincipal(key);
      await expect(
        asPrincipal(caller, (context) =>
          runCommand(
            setRolePermissions,
            { context, audit, outbox },
            { roleKey: EDITED, grants: edited() },
          ),
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(await customisedAt(EDITED)).toBeNull();
  });

  it('is refused for an Executive whose request is narrowed to one company', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          setRolePermissions,
          { context, audit, outbox },
          { roleKey: EDITED, grants: edited() },
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'role_group_scope' } });
    expect(await customisedAt(EDITED)).toBeNull();
  });

  it('never edits an agent role or a system role', async () => {
    const exec = await createTestPrincipal('executive');
    for (const roleKey of ['agent:triage', 'agent:sizing', 'system:workers']) {
      await expect(
        asPrincipal(exec, (context) =>
          runCommand(
            setRolePermissions,
            { context, audit, outbox },
            { roleKey, grants: [{ permission: 'crm.lead.read', scope: 'entity' }] },
          ),
        ),
      ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'role_not_editable' } });
    }
    expect(await grantsOf('agent:triage')).toEqual(
      grantsForRole('agent:triage')
        .map((g) => `${g.key}:${g.scope}`)
        .sort(),
    );
  });

  it('keeps admin.roles.write and admin.users.write at all on the Executive role', async () => {
    const exec = await createTestPrincipal('executive');
    const before = await grantsOf('executive');
    const withoutRoles = seeded('executive').filter((g) => g.permission !== 'admin.roles.write');
    const usersNarrowed = seeded('executive').map((g) =>
      g.permission === 'admin.users.write' ? { ...g, scope: 'entity' as const } : g,
    );
    for (const grants of [withoutRoles, usersNarrowed]) {
      await expect(
        asPrincipal(exec, (context) =>
          runCommand(
            setRolePermissions,
            { context, audit, outbox },
            { roleKey: 'executive', grants },
          ),
        ),
      ).rejects.toMatchObject({
        code: 'validation_failed',
        details: { reason: 'executive_keeps_admin' },
      });
    }
    expect(await grantsOf('executive')).toEqual(before);
    expect(await customisedAt('executive')).toBeNull();
  });

  it('refuses a permission outside the catalogue before it reaches the database', async () => {
    const exec = await createTestPrincipal('executive');
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          setRolePermissions,
          { context, audit, outbox },
          { roleKey: EDITED, grants: [{ permission: 'files.process', scope: 'all' }] },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await customisedAt(EDITED)).toBeNull();
  });
});

describe('admin.role.permissions.set: the change', () => {
  it('replaces the set, marks the role customised, signs every holder out and keeps the caller in', async () => {
    // A holder in company 1, one in company 3, and the caller, who holds the role in company 2.
    const holderOne = await createTestUser([{ entityId: 1, roleKey: EDITED }]);
    const holderThree = await createTestUser([
      { entityId: 3, roleKey: EDITED },
      { entityId: 4, roleKey: 'accounts' },
    ]);
    const callerUser = await createTestUser([
      { entityId: 1, roleKey: 'executive' },
      { entityId: 2, roleKey: EDITED },
    ]);
    const bystander = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    const exec = await createTestPrincipal('executive', ALL_ENTITY_IDS, { id: callerUser.id });
    const sessions = {
      one: await addSession(holderOne.id),
      three: await addSession(holderThree.id),
      callerKept: await addSession(callerUser.id),
      callerOther: await addSession(callerUser.id),
      bystander: await addSession(bystander.id),
    };
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    try {
      const dto = await asPrincipal(exec, (context) =>
        runCommand(
          setRolePermissions,
          { context, audit: recorded, outbox: emitted },
          { roleKey: EDITED, grants: edited(), keepSessionId: sessions.callerKept },
        ),
      );
      expect(dto).toMatchObject({
        roleId: roleId(EDITED),
        roleKey: EDITED,
        grantCount: edited().length,
        revokedSessions: expect.any(Number),
      });
      expect(dto.customisedAt).not.toBeNull();
      expect(dto.holderUserIds).toEqual(
        expect.arrayContaining([holderOne.id, holderThree.id, callerUser.id]),
      );
      expect(dto.holderUserIds).not.toContain(bystander.id);

      expect(await grantsOf(EDITED)).toEqual(
        edited()
          .map((g) => `${g.permission}:${g.scope}`)
          .sort(),
      );
      expect(await customisedAt(EDITED)).not.toBeNull();
      expect(await sessionState(Object.values(sessions))).toEqual({
        [sessions.one]: 'role_changed',
        [sessions.three]: 'role_changed',
        [sessions.callerKept]: null,
        [sessions.callerOther]: 'role_changed',
        [sessions.bystander]: null,
      });

      const [row] = recorded.records;
      expect(recorded.records).toHaveLength(1);
      expect(row).toMatchObject({
        command: 'admin.role.permissions.set',
        aggregateType: 'role',
        aggregateId: roleId(EDITED),
        entityId: null,
      });
      expect(JSON.stringify(row?.after)).toContain('pricing.read');
      expect(JSON.stringify(row?.before)).toContain('hr.export');
      expect(emitted.records).toEqual([
        expect.objectContaining({
          type: 'admin.role.permissions_changed',
          aggregateId: roleId(EDITED),
          payload: expect.objectContaining({
            roleId: roleId(EDITED),
            added: 1,
            removed: 1,
            rescoped: 1,
            grantCount: edited().length,
          }),
        }),
      ]);

      // A re-run of the seed keeps the edit (docs/DATABASE.md §9).
      await runSeeds();
      expect(await grantsOf(EDITED)).toEqual(
        edited()
          .map((g) => `${g.permission}:${g.scope}`)
          .sort(),
      );
    } finally {
      await restore(EDITED);
    }
    expect(await grantsOf(EDITED)).toEqual(
      seeded(EDITED)
        .map((g) => `${g.permission}:${g.scope}`)
        .sort(),
    );
  });

  it('spares only a session of the caller, never another holder named as the one to keep', async () => {
    const holder = await createTestUser([{ entityId: 2, roleKey: EDITED }]);
    const exec = await createTestPrincipal('executive');
    const session = await addSession(holder.id);
    try {
      await asPrincipal(exec, (context) =>
        runCommand(
          setRolePermissions,
          { context, audit, outbox },
          { roleKey: EDITED, grants: edited(), keepSessionId: session },
        ),
      );
      expect(await sessionState([session])).toEqual({ [session]: 'role_changed' });
    } finally {
      await restore(EDITED);
    }
  });

  it('changes nothing and signs no one out when the set is the same', async () => {
    const holder = await createTestUser([{ entityId: 1, roleKey: EDITED }]);
    const exec = await createTestPrincipal('executive');
    const session = await addSession(holder.id);
    const emitted = memoryOutboxSink();
    try {
      const dto = await asPrincipal(exec, (context) =>
        runCommand(
          setRolePermissions,
          { context, audit, outbox: emitted },
          { roleKey: EDITED, grants: seeded(EDITED) },
        ),
      );
      expect(dto).toMatchObject({ revokedSessions: 0, holderUserIds: [], customisedAt: null });
      expect(emitted.records).toEqual([]);
      expect(await sessionState([session])).toEqual({ [session]: null });
      expect(await customisedAt(EDITED)).toBeNull();
    } finally {
      await restore(EDITED);
    }
  });
});
