import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { resetTwoFactor } from '../../src/commands/admin/two-factor-reset';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

afterAll(closeDb);

/** A user with an enrolled authenticator app and one live session, as the auth module leaves them. */
async function enrolledUser(entityRoles: Parameters<typeof createTestUser>[0]) {
  const user = await createTestUser(entityRoles, { twoFactorEnabled: true });
  const session = newId();
  await asMigrator(async (m) => {
    await m`insert into user_two_factor (id, user_id, secret, backup_codes)
            values (${newId()}, ${user.id}, 'sealed', 'sealed')`;
    await m`insert into sessions (id, user_id, token, expires_at)
            values (${session}, ${user.id}, ${`tok-${session}`}, now() + interval '12 hours')`;
  });
  return { user, session };
}

async function twoFactorState(userId: string) {
  const [row] = await asMigrator(
    (m) => m<{ enabled: boolean; apps: number }[]>`
      select u.two_factor_enabled as enabled,
             (select count(*)::int from user_two_factor t where t.user_id = u.id) as apps
        from users u where u.id = ${userId}`,
  );
  return row;
}

async function sessionReasons(userId: string): Promise<(string | null)[]> {
  const rows = await asMigrator(
    (m) => m<{ reason: string | null }[]>`
      select revoked_reason as reason from sessions where user_id = ${userId}`,
  );
  return rows.map((r) => r.reason);
}

describe('admin.user.two_factor.reset (review 3)', () => {
  it('is denied for a General Manager and refuses the caller’s own account', async () => {
    const { user } = await enrolledUser([{ entityId: 1, roleKey: 'accounts' }]);
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(resetTwoFactor, { context, audit, outbox }, { userId: user.id }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const exec = await createTestPrincipal('executive');
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(resetTwoFactor, { context, audit, outbox }, { userId: exec.id }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'self_two_factor_reset' },
    });
    expect(await twoFactorState(user.id)).toEqual({ enabled: true, apps: 1 });
  });

  it('refuses an unknown user and someone who also works outside the request scope', async () => {
    const exec1 = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(resetTwoFactor, { context, audit, outbox }, { userId: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'user_missing' } });

    const { user } = await enrolledUser([
      { entityId: 1, roleKey: 'accounts' },
      { entityId: 2, roleKey: 'accounts' },
    ]);
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(resetTwoFactor, { context, audit, outbox }, { userId: user.id }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'user_roles_outside_scope' } });
    expect(await twoFactorState(user.id)).toEqual({ enabled: true, apps: 1 });
  });

  it('removes the app, clears the flag, signs the user out everywhere, audits and emits', async () => {
    const exec = await createTestPrincipal('executive');
    const { user } = await enrolledUser([
      { entityId: 1, roleKey: 'accounts' },
      { entityId: 2, roleKey: 'accounts' },
    ]);
    const dto = await asPrincipal(exec, (context) =>
      runCommand(resetTwoFactor, { context, audit, outbox }, { userId: user.id }),
    );
    expect(dto.twoFactorEnabled).toBe(false);
    expect(await twoFactorState(user.id)).toEqual({ enabled: false, apps: 0 });
    expect(await sessionReasons(user.id)).toEqual(['totp_reset']);

    const rows = await asMigrator(
      (m) => m<{ before: unknown; after: unknown; entity: number | null }[]>`
        select before_json as before, after_json as after, entity_id as entity from audit_logs
         where aggregate_id = ${user.id} and command = 'admin.user.two_factor.reset'`,
    );
    expect(rows).toEqual([
      {
        before: { twoFactorEnabled: true },
        after: { twoFactorEnabled: false, revokedSessions: 1 },
        entity: null,
      },
    ]);
    const events = await asOutboxPublisher(
      (p) => p<{ type: string; entity: number; payload: unknown }[]>`
        select type, entity_id as entity, payload_json as payload from outbox_events
         where aggregate_id = ${user.id} order by entity_id`,
    );
    expect(events).toEqual(
      [1, 2].map((entity) => ({
        type: 'admin.user.two_factor_reset',
        entity,
        payload: { revokedSessions: 1, v: 1 },
      })),
    );
  });

  it('answers a user with no authenticator app as is, changing nothing', async () => {
    const exec = await createTestPrincipal('executive');
    const user = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
    const session = newId();
    await asMigrator(
      (m) => m`insert into sessions (id, user_id, token, expires_at)
               values (${session}, ${user.id}, ${`tok-${session}`}, now() + interval '12 hours')`,
    );
    const dto = await asPrincipal(exec, (context) =>
      runCommand(resetTwoFactor, { context, audit, outbox }, { userId: user.id }),
    );
    expect(dto.twoFactorEnabled).toBe(false);
    expect(await sessionReasons(user.id)).toEqual([null]);
  });
});
