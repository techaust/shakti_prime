import * as SecureStore from 'expo-secure-store';
import { fakeApi, me, no, ok, tokenPair } from '../test/fake-api';
import type { Api } from './api';
import {
  createSession,
  LOCK_AFTER_BACKGROUND_MS,
  PIN_TRIES,
  REFRESH_BEFORE_EXPIRY_MS,
  type SessionOptions,
} from './session';
import { tokenStore } from './token-store';

const values = (SecureStore as unknown as { __values: Map<string, string> }).__values;
const session = (api: ReturnType<typeof fakeApi>, options?: SessionOptions) =>
  createSession(api as unknown as Api, undefined, options);

/** A phone's clock the test moves by hand. */
function phoneClock() {
  let at = Date.parse('2026-11-27T10:00:00.000Z');
  return {
    now: () => at,
    pass: (ms: number) => {
      at += ms;
    },
  };
}

const ACCESS_MS = 15 * 60 * 1000;

beforeEach(() => {
  values.clear();
});

describe('the session', () => {
  it('starts signed out, signs in to choose a PIN, and keeps only the refresh token', async () => {
    const api = fakeApi();
    const s = session(api);
    await s.start();
    expect(s.getState()).toEqual({ status: 'signedOut' });
    expect(await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river')).toEqual({
      ok: true,
    });
    expect(s.getState()).toEqual({ status: 'locked', hasPin: false });
    expect(await tokenStore.refreshToken()).toBe(tokenPair(1).refreshToken);
    expect([...values.values()].join(' ')).not.toContain(tokenPair(1).accessToken);
    const sent = api.signIn.mock.calls[0]?.[0] as {
      device: { deviceId: string; appVersion: string };
    };
    expect(sent.device).toMatchObject({ platform: 'android', appVersion: '1.0.0' });
    expect(Object.keys(sent.device)).not.toContain('model');
    await s.choosePin('2468');
    expect(s.getState()).toEqual({
      status: 'ready',
      person: { name: 'Rakesh Meena', email: 'rakesh.meena@shaktisupreme.in' },
      offline: false,
    });
  });

  it('asks for the authenticator code when the server does', async () => {
    const s = session(fakeApi({ signIn: jest.fn(() => no('totp_required')) }));
    expect(await s.signIn('exec@shaktisupreme.in', 'monsoon pump 2026 river')).toEqual({
      ok: false,
      error: 'errors.totp_required',
      needsCode: true,
    });
  });

  it('opens with the PIN after a restart, refreshing first, and works offline when it must', async () => {
    const api = fakeApi();
    await session(api).signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await tokenStore.savePin('2468');
    await tokenStore.savePerson({ name: 'Rakesh Meena', email: 'rakesh.meena@shaktisupreme.in' });
    const offline = fakeApi({ refresh: jest.fn(() => no('offline')) });
    const restarted = session(offline);
    await restarted.start();
    expect(restarted.getState()).toEqual({ status: 'locked', hasPin: true });
    expect(await restarted.unlockWithPin('2468')).toBeUndefined();
    expect(restarted.getState()).toMatchObject({
      status: 'ready',
      offline: true,
      person: { name: 'Rakesh Meena' },
    });
  });

  it('signs the phone out after too many wrong PINs', async () => {
    const s = session(fakeApi());
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await tokenStore.savePin('2468');
    for (let left = PIN_TRIES - 1; left > 0; left -= 1) {
      expect(await s.unlockWithPin('1111')).toEqual({ triesLeft: left });
    }
    expect(await s.unlockWithPin('1111')).toEqual({ triesLeft: 0 });
    expect(s.getState()).toEqual({ status: 'signedOut', notice: 'unlock.tooManyTries' });
    expect(await tokenStore.refreshToken()).toBeNull();
  });

  it('signs out here when the server has signed the phone out', async () => {
    const api = fakeApi({
      me: jest.fn(() => no('device_revoked')),
      refresh: jest.fn(() => no('device_revoked')),
    });
    const s = session(api);
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await s.choosePin('2468');
    expect(s.getState()).toEqual({ status: 'signedOut', notice: 'errors.device_revoked' });
    expect(await tokenStore.refreshToken()).toBeNull();
  });

  it('holds at the update gate below the minimum version', async () => {
    const s = session(fakeApi({ me: jest.fn(() => ok(me('1.2.0'))) }));
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await s.choosePin('2468');
    expect(s.getState()).toEqual({ status: 'updateRequired', minimum: '1.2.0' });
    const refused = session(fakeApi({ signIn: jest.fn(() => no('app_update_required')) }));
    await refused.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    expect(refused.getState()).toEqual({ status: 'updateRequired' });
  });

  it('sends one refresh however many calls ask for a token at once', async () => {
    const api = fakeApi();
    await session(fakeApi()).signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    const restarted = session(api);
    await restarted.start();
    const tokens = await Promise.all([
      restarted.accessToken(),
      restarted.accessToken(),
      restarted.accessToken(),
    ]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(new Set(tokens)).toEqual(new Set([tokenPair(2).accessToken]));
    expect(await tokenStore.refreshToken()).toBe(tokenPair(2).refreshToken);
  });

  it('signs out at the server and here', async () => {
    const api = fakeApi();
    const s = session(api);
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await s.signOut();
    expect(api.revoke).toHaveBeenCalledWith(tokenPair(1).accessToken);
    expect(s.getState()).toEqual({ status: 'signedOut' });
  });

  it('names the phone’s model and Android version at sign-in, so its owner’s phones differ', async () => {
    const api = fakeApi();
    const s = session(api, { phone: () => ({ model: 'Galaxy M14', osVersion: '14' }) });
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    expect(api.signIn).toHaveBeenCalledWith(
      expect.objectContaining({
        device: expect.objectContaining({ model: 'Galaxy M14', osVersion: '14' }),
      }),
    );
  });

  it('uses the access token while it has more than a minute left, and refreshes it before then', async () => {
    const clock = phoneClock();
    const api = fakeApi();
    const s = session(api, { now: clock.now });
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    clock.pass(ACCESS_MS - REFRESH_BEFORE_EXPIRY_MS - 1000);
    expect(await s.accessToken()).toBe(tokenPair(1).accessToken);
    expect(api.refresh).not.toHaveBeenCalled();
    clock.pass(1000);
    expect(await s.accessToken()).toBe(tokenPair(2).accessToken);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    // The new token counts its own fifteen minutes from when it arrived.
    clock.pass(ACCESS_MS - REFRESH_BEFORE_EXPIRY_MS - 1000);
    expect(await s.accessToken()).toBe(tokenPair(2).accessToken);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes once and tries again when a call is refused with no reason, before signing out', async () => {
    const clock = phoneClock();
    const meCall = jest
      .fn()
      .mockImplementation((token: string) =>
        token === tokenPair(1).accessToken ? no('unauthorized') : ok(me()),
      );
    const api = fakeApi({ me: meCall });
    const s = session(api, { now: clock.now });
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await s.choosePin('2468');
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(meCall.mock.calls.map((c) => c[0])).toEqual([
      tokenPair(1).accessToken,
      tokenPair(2).accessToken,
    ]);
    expect(s.getState()).toMatchObject({ status: 'ready', offline: false });

    // Refused again after the refresh: the phone's sign-in has ended.
    const refusedTwice = session(fakeApi({ me: jest.fn(() => no('unauthorized')) }));
    await refusedTwice.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await refusedTwice.choosePin('2468');
    expect(refusedTwice.getState()).toEqual({
      status: 'signedOut',
      notice: 'errors.unauthorized',
    });
  });

  it('refreshes before signing out with an old token, so the server ends the phone’s sign-in', async () => {
    const clock = phoneClock();
    const api = fakeApi();
    const s = session(api, { now: clock.now });
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    clock.pass(ACCESS_MS + 60_000);
    await s.signOut();
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(api.revoke).toHaveBeenCalledWith(tokenPair(2).accessToken);
    expect(s.getState()).toEqual({ status: 'signedOut' });
    expect(await tokenStore.refreshToken()).toBeNull();
  });

  it('asks for the PIN again after five minutes in the background, not after less', async () => {
    const clock = phoneClock();
    const s = session(fakeApi(), { now: clock.now });
    await s.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await s.choosePin('2468');
    expect(s.getState()).toMatchObject({ status: 'ready' });
    s.wentToBackground();
    clock.pass(LOCK_AFTER_BACKGROUND_MS - 1000);
    await s.cameToForeground();
    expect(s.getState()).toMatchObject({ status: 'ready' });
    s.wentToBackground();
    clock.pass(LOCK_AFTER_BACKGROUND_MS);
    await s.cameToForeground();
    expect(s.getState()).toEqual({ status: 'locked', hasPin: true });
    expect(await s.unlockWithPin('2468')).toBeUndefined();
    expect(s.getState()).toMatchObject({ status: 'ready' });
  });
});
