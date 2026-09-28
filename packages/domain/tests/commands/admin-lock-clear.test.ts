import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { clearSignInLock } from '../../src/commands/admin/clear-sign-in-lock';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

afterAll(closeDb);

async function auditRows(userId: string) {
  return asMigrator(
    (m) => m<{ actor: string; before: unknown; after: unknown; entity: number | null }[]>`
      select actor_principal_id as actor, before_json as before, after_json as after, entity_id as entity
        from audit_logs
       where aggregate_id = ${userId} and command = 'admin.user.lock.clear' and outcome = 'ok'`,
  );
}

describe('admin.user.lock.clear (final audit)', () => {
  it('is denied for a General Manager and refuses the caller’s own account', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(clearSignInLock, { context, audit, outbox }, { userId: user.id }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const exec = await createTestPrincipal('executive');
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(clearSignInLock, { context, audit, outbox }, { userId: exec.id }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'self_lock_clear' } });
    expect(await auditRows(user.id)).toEqual([]);
  });

  it('refuses an unknown person and someone who also works outside the request scope', async () => {
    const exec1 = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(clearSignInLock, { context, audit, outbox }, { userId: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'user_missing' } });

    const user = await createTestUser([
      { entityId: 1, roleKey: 'accounts' },
      { entityId: 2, roleKey: 'accounts' },
    ]);
    await expect(
      asPrincipal(exec1, (context) =>
        runCommand(clearSignInLock, { context, audit, outbox }, { userId: user.id }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'user_roles_outside_scope' } });
    expect(await auditRows(user.id)).toEqual([]);
  });

  it('answers the person, with the email the action lifts the lock for, and records one row', async () => {
    const exec = await createTestPrincipal('executive');
    const user = await createTestUser([{ entityId: 1, roleKey: 'store_manager' }]);
    const dto = await asPrincipal(exec, (context) =>
      runCommand(clearSignInLock, { context, audit, outbox }, { userId: user.id }),
    );
    expect(dto).toMatchObject({ id: user.id, email: user.email });
    expect(await auditRows(user.id)).toEqual([
      { actor: exec.id, before: null, after: null, entity: null },
    ]);
  });
});
