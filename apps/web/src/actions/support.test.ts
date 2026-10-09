import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted((): { principal: { id: string } | undefined; held: boolean } => ({
  principal: undefined,
  held: true,
}));

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('../workers/outbox', () => ({ nudgeOutbox: () => undefined }));
vi.mock('../auth/current-principal', () => ({
  currentPrincipal: () => Promise.resolve(state.principal),
  currentSession: () => Promise.resolve(undefined),
  currentPrincipalIn: () => Promise.resolve(state.held ? state.principal : undefined),
}));

const { signedInIn } = await import('./support');

describe('signedInIn', () => {
  it('throws unauthorized when nobody is signed in, as signedIn does', async () => {
    state.principal = undefined;
    await expect(signedInIn(1)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('throws forbidden for a company the person holds no role in', async () => {
    state.principal = { id: 'u1' };
    state.held = false;
    await expect(signedInIn(1)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('answers the person as they act in a company they hold', async () => {
    state.principal = { id: 'u1' };
    state.held = true;
    await expect(signedInIn(1)).resolves.toMatchObject({ id: 'u1' });
  });
});
