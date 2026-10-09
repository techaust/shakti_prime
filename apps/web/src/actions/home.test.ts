import type * as Domain from '@shakti/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The home actions are public endpoints: the companies they read come from the session, never
// from the caller's arguments, and a missing session is `unauthorized`.
interface State {
  principal: { id: string; entityIds: number[] } | undefined;
  session:
    | { access: { entities: { entityId: number; roleKey: string; entityName: string }[] } }
    | undefined;
  calls: { entityIds: readonly number[] | undefined; name: string | undefined }[];
}
const state = vi.hoisted((): State => ({ principal: undefined, session: undefined, calls: [] }));

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('../workers/outbox', () => ({ nudgeOutbox: () => undefined }));
vi.mock('../auth/current-principal', () => ({
  currentPrincipal: () => Promise.resolve(state.principal),
  currentSession: () => Promise.resolve(state.session),
  currentPrincipalIn: (entityId: number) =>
    Promise.resolve(
      state.principal === undefined ? undefined : { ...state.principal, entityIds: [entityId] },
    ),
}));
vi.mock('@shakti/domain', async (importOriginal) => ({
  ...(await importOriginal<typeof Domain>()),
  executeQuery: (
    _principal: unknown,
    scope: { entityIds?: readonly number[] },
    _query: unknown,
    options?: { name?: string },
  ) => {
    state.calls.push({ entityIds: scope.entityIds, name: options?.name });
    return Promise.resolve([]);
  },
}));

const { homeCaller, homeCredit, homePipeline, homeResponseTimes } = await import('./home');
const { myProgress } = await import('./targets');

function signIn(roles: { entityId: number; roleKey: string }[], viewed: number[]): void {
  state.principal = { id: 'u1', entityIds: viewed };
  state.session = { access: { entities: roles.map((r) => ({ ...r, entityName: 'Company' })) } };
}

beforeEach(() => {
  state.calls = [];
  state.principal = undefined;
  state.session = undefined;
});

describe('the home actions', () => {
  it('read only the session’s companies, whatever the caller sends', async () => {
    signIn(
      [
        { entityId: 1, roleKey: 'tele_caller_cc' },
        { entityId: 2, roleKey: 'tele_caller_lc' },
        { entityId: 3, roleKey: 'accounts' },
      ],
      [1, 2, 3],
    );
    const hostile = Array.from({ length: 500 }, () => 1);
    await (homeCaller as unknown as (...a: unknown[]) => Promise<unknown>)(hostile);
    expect(state.calls.map((c) => c.entityIds)).toEqual([[1], [2]]);
    state.calls = [];
    await (myProgress as unknown as (...a: unknown[]) => Promise<unknown>)(hostile);
    expect(state.calls.map((c) => c.entityIds)).toEqual([[1], [2]]);
  });

  it('read nothing in a company the person views without that section, or does not view', async () => {
    signIn(
      [
        { entityId: 1, roleKey: 'accounts' },
        { entityId: 2, roleKey: 'accounts' },
      ],
      [2],
    );
    await homeCredit();
    expect(state.calls.map((c) => c.entityIds)).toEqual([[2]]);
    state.calls = [];
    await homeResponseTimes();
    expect(state.calls).toEqual([]);
  });

  it('name each section’s own query for the slow-query log', async () => {
    signIn([{ entityId: 1, roleKey: 'general_manager' }], [1]);
    await homeResponseTimes();
    await homePipeline('manager');
    expect(state.calls.map((c) => c.name)).toEqual(['homeResponseTimes', 'homePipeline']);
  });

  it('refuse a pipeline section other than the manager’s or the executive’s', async () => {
    signIn([{ entityId: 1, roleKey: 'tele_caller_cc' }], [1]);
    const result = await homePipeline('caller');
    expect(result.ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it('answer unauthorized when nobody is signed in', async () => {
    const result = await homeCaller();
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('unauthorized');
  });
});
