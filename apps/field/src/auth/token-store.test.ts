import * as SecureStore from 'expo-secure-store';
import { tokenStore } from './token-store';

const values = (SecureStore as unknown as { __values: Map<string, string> }).__values;

describe('the token store', () => {
  beforeEach(() => {
    values.clear();
    jest.clearAllMocks();
  });

  it('keeps the refresh token in the secure store, readable only on this unlocked phone', async () => {
    await tokenStore.saveRefreshToken('r'.repeat(43));
    expect(await tokenStore.refreshToken()).toBe('r'.repeat(43));
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('shakti.refresh_token', 'r'.repeat(43), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });

  it('makes the installation id once and keeps it after a sign-out', async () => {
    const first = await tokenStore.deviceId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await tokenStore.saveRefreshToken('r'.repeat(43));
    await tokenStore.savePin('2468');
    await tokenStore.savePerson({ name: 'Rakesh Meena', email: 'rakesh.meena@shaktisupreme.in' });
    await tokenStore.clear();
    expect(await tokenStore.deviceId()).toBe(first);
    expect(await tokenStore.refreshToken()).toBeNull();
    expect(await tokenStore.pin()).toBeNull();
    expect(await tokenStore.person()).toBeNull();
  });

  it('counts wrong PINs and starts again when a PIN is chosen', async () => {
    expect(await tokenStore.pinTries()).toBe(0);
    await tokenStore.savePinTries(3);
    expect(await tokenStore.pinTries()).toBe(3);
    await tokenStore.savePin('1357');
    expect(await tokenStore.pinTries()).toBe(0);
  });
});
