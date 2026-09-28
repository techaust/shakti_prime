import { newId, type Principal, type SavedViewSettings } from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { closeDb, createTestPrincipal } from '@shakti/db/testing';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The saved-view actions outside a Next.js request, as in `actions.test.ts`: the request headers
// and the signed-in caller are stand-ins; the commands and the database are real.
const request = vi.hoisted((): { principal: Principal | undefined; headers: Headers } => ({
  principal: undefined,
  headers: new Headers(),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(request.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));

vi.mock('../src/auth/current-principal', () => ({
  currentPrincipal: () => Promise.resolve(request.principal),
  forgetPrincipal: () => Promise.resolve(),
}));

const { deleteView, listSavedViews, saveView } = await import('../src/actions/profile');

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});
beforeEach(() => {
  request.principal = undefined;
  request.headers = new Headers();
});

function ok<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

const settings: SavedViewSettings = {
  columns: { hidden: ['email'] },
  sort: { columnId: 'name', direction: 'asc' },
  filters: {},
  density: 'comfortable',
};

describe('saved view actions answer a result, never a thrown error', () => {
  it('ask who is calling first', async () => {
    await expect(listSavedViews({ screen: 'leads' })).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
    await expect(saveView({ screen: 'leads', name: 'Mine', settings })).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('save, list, rename and delete a view of the caller, once per form key', async () => {
    request.principal = await createTestPrincipal('executive');
    const name = `Pending invites ${newId().slice(-8)}`;
    const key = newId();
    const input = { screen: 'team_members', name, settings };
    const view = ok(await saveView(input, key));
    expect(ok(await saveView(input, key))).toEqual(view);
    expect(
      ok(await listSavedViews({ screen: 'team_members' })).filter((v) => v.name === name),
    ).toHaveLength(1);

    const renamed = ok(
      await saveView({ id: view.id, screen: 'team_members', name: `${name} 2`, settings }, newId()),
    );
    expect(renamed).toMatchObject({ id: view.id, name: `${name} 2` });

    await expect(
      saveView({ screen: 'team_members', name: `${name} 2`, settings }),
    ).resolves.toEqual({ ok: false, error: 'saved_view_name_taken' });
    expect(ok(await deleteView({ id: view.id }, newId()))).toEqual({ id: view.id });
    await expect(deleteView({ id: view.id })).resolves.toEqual({
      ok: false,
      error: 'saved_view_gone',
    });
  });

  it('name the field of an input problem', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(saveView({ screen: 'leads', name: '', settings })).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      field: 'name',
    });
    await expect(listSavedViews({ screen: 'stock' })).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
    });
  });
});
