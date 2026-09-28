import { asMigrator, asPrincipal, closeDb, createTestUser, principalFor } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { setContrast } from '../../src/commands/profile/set-contrast';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

afterAll(closeDb);

async function rowOf(id: string): Promise<{ contrast: string; theme: string; name: string }> {
  const [row] = await asMigrator(
    (m) =>
      m<
        { contrast: string; theme: string; name: string }[]
      >`select contrast, theme, name from users where id = ${id}`,
  );
  if (!row) throw new Error('user row exists');
  return row;
}

describe('profile.contrast.set', () => {
  it('is denied to an agent principal, which holds no profile.write', async () => {
    const agent = principalFor('agent:triage', [1]);
    await expect(
      asPrincipal(agent, (context) =>
        runCommand(setContrast, { context, audit, outbox }, { contrast: 'high' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects a value other than standard and high', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const principal = principalFor('tele_caller_cc', [1], { id: user.id });
    await expect(
      asPrincipal(principal, (context) =>
        runCommand(setContrast, { context, audit, outbox }, { contrast: 'maximum' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it("saves the caller's own contrast, changes nothing else, and records it once", async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }], {
      name: 'contrast owner',
    });
    const other = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
    const principal = principalFor('field_engineer', [1], { id: user.id });

    const dto = await asPrincipal(principal, (context) =>
      runCommand(setContrast, { context, audit, outbox }, { contrast: 'high' }),
    );

    expect(dto).toEqual({ contrast: 'high' });
    expect(await rowOf(user.id)).toEqual({
      contrast: 'high',
      theme: 'system',
      name: 'contrast owner',
    });
    expect((await rowOf(other.id)).contrast).toBe('standard');

    const rows = await asMigrator(
      (m) => m<
        {
          command: string;
          outcome: string;
          entity_id: number | null;
          aggregate_type: string;
          aggregate_id: string;
          before_json: unknown;
          after_json: unknown;
        }[]
      >`select command, outcome, entity_id, aggregate_type, aggregate_id, before_json, after_json
          from audit_logs where actor_principal_id = ${user.id} and command = 'profile.contrast.set'`,
    );
    expect(rows).toEqual([
      {
        command: 'profile.contrast.set',
        outcome: 'ok',
        entity_id: null,
        aggregate_type: 'user',
        aggregate_id: user.id,
        before_json: { contrast: 'standard' },
        after_json: { contrast: 'high' },
      },
    ]);
  });

  it('answers not_found for a suspended user and leaves the row as it was', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'accounts' }], {
      status: 'suspended',
    });
    const principal = principalFor('accounts', [1], { id: user.id });
    await expect(
      asPrincipal(principal, (context) =>
        runCommand(setContrast, { context, audit, outbox }, { contrast: 'high' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await rowOf(user.id)).contrast).toBe('standard');
  });

  it('the database function refuses a caller without profile.write:own', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const principal = principalFor('tele_caller_cc', [1], { id: user.id, permissions: [] });
    await expect(
      asPrincipal(principal, (context) =>
        context.tx.execute(sql`select app.set_own_contrast('high')`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect((await rowOf(user.id)).contrast).toBe('standard');
  });
});
