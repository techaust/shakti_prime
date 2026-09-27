import { asMigrator, asPrincipal, closeDb, createTestUser, principalFor } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { runCommand } from '../../src/command/run-command';
import { setTheme } from '../../src/commands/profile/set-theme';

afterAll(closeDb);

async function themeOf(id: string): Promise<{ theme: string; name: string; status: string }> {
  const [row] = await asMigrator(
    (m) =>
      m<
        { theme: string; name: string; status: string }[]
      >`select theme, name, status from users where id = ${id}`,
  );
  if (!row) throw new Error('user row exists');
  return row;
}

describe('profile.theme.set', () => {
  it('is denied to an agent principal, which holds no profile.write', async () => {
    const agent = principalFor('agent:triage', [1]);
    await expect(
      asPrincipal(agent, (context) =>
        runCommand(setTheme, { context, audit, outbox }, { theme: 'dark' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects a value outside System, Light and Dark', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const principal = principalFor('tele_caller_cc', [1], { id: user.id });
    await expect(
      asPrincipal(principal, (context) =>
        runCommand(setTheme, { context, audit, outbox }, { theme: 'sepia' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it("saves the caller's own theme and changes nothing else", async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }], {
      name: 'theme owner',
    });
    const other = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const principal = principalFor('tele_caller_cc', [1], { id: user.id });

    const dto = await asPrincipal(principal, (context) =>
      runCommand(setTheme, { context, audit, outbox }, { theme: 'dark' }),
    );

    expect(dto).toEqual({ theme: 'dark' });
    expect(await themeOf(user.id)).toEqual({
      theme: 'dark',
      name: 'theme owner',
      status: 'active',
    });
    expect((await themeOf(other.id)).theme).toBe('system');
  });

  it('answers not_found for a suspended user and leaves the row as it was', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'accounts' }], {
      status: 'suspended',
    });
    const principal = principalFor('accounts', [1], { id: user.id });
    await expect(
      asPrincipal(principal, (context) =>
        runCommand(setTheme, { context, audit, outbox }, { theme: 'light' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await themeOf(user.id)).theme).toBe('system');
  });

  it('the database function refuses a caller without profile.write:own', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const principal = principalFor('tele_caller_cc', [1], { id: user.id, permissions: [] });
    await expect(
      asPrincipal(principal, (context) =>
        context.tx.execute(sql`select app.set_own_theme('dark')`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect((await themeOf(user.id)).theme).toBe('system');
  });
});
