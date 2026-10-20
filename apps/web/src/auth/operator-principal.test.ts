import type { UserGrantRow } from '@shakti/db/grants';
import { describe, expect, it } from 'vitest';
import { assertCommandLine, chooseExecutive } from './operator-principal';

function rows(
  roles: { entityId: number; roleKey: string }[],
  options: { twoFactorEnabled?: boolean; status?: string } = {},
): UserGrantRow[] {
  return roles.map((r) => ({
    status: options.status ?? 'active',
    theme: 'system',
    contrast: 'standard',
    name: 'someone',
    email: 'someone@example.com',
    twoFactorEnabled: options.twoFactorEnabled ?? true,
    entityId: r.entityId,
    entityName: `company ${String(r.entityId)}`,
    roleKey: r.roleKey,
    teamId: null,
    permissionKey: 'admin.users.write',
    scope: 'all',
  }));
}

const executive = [1, 2, 3, 4].map((entityId) => ({ entityId, roleKey: 'executive' }));

function grants(table: Record<string, UserGrantRow[]>) {
  return (id: string) => Promise.resolve(table[id] ?? []);
}

describe('chooseExecutive', () => {
  it('answers none when nobody is an Executive', async () => {
    expect(await chooseExecutive([], grants({}))).toEqual({ kind: 'none' });
    expect(
      await chooseExecutive(
        [{ id: 'a', name: 'Caller' }],
        grants({ a: rows([{ entityId: 1, roleKey: 'tele_caller_cc' }]) }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('answers not_ready when the only Executives have no authenticator app yet', async () => {
    expect(
      await chooseExecutive(
        [{ id: 'a', name: 'Waiting Executive' }],
        grants({ a: rows(executive, { twoFactorEnabled: false }) }),
      ),
    ).toEqual({ kind: 'not_ready', name: 'Waiting Executive' });
  });

  it('passes over someone who is Executive in one company and holds another role elsewhere', async () => {
    const found = await chooseExecutive(
      [
        { id: 'mixed', name: 'Mixed roles' },
        { id: 'waiting', name: 'Waiting Executive' },
        { id: 'ready', name: 'Ready Executive' },
      ],
      grants({
        mixed: rows([
          { entityId: 1, roleKey: 'executive' },
          { entityId: 2, roleKey: 'accounts' },
        ]),
        waiting: rows(executive, { twoFactorEnabled: false }),
        ready: rows(executive),
      }),
    );
    expect(found.kind).toBe('ready');
    if (found.kind !== 'ready') return;
    expect(found.name).toBe('Ready Executive');
    expect(found.principal).toMatchObject({
      id: 'ready',
      roleKey: 'executive',
      entityIds: [1, 2, 3, 4],
    });
  });
});

describe('assertCommandLine', () => {
  it('refuses inside Next.js and on a hosted runtime, and allows a command line', () => {
    expect(() => {
      assertCommandLine({ NODE_ENV: 'development', NEXT_RUNTIME: 'nodejs' });
    }).toThrow(/command-line scripts only/);
    expect(() => {
      assertCommandLine({ NODE_ENV: 'production', BOS_ENVIRONMENT: 'staging' });
    }).toThrow(/command-line scripts only/);
    expect(() => {
      assertCommandLine({ NODE_ENV: 'development' });
    }).not.toThrow();
    expect(() => {
      assertCommandLine({ NODE_ENV: 'test' });
    }).not.toThrow();
  });
});
