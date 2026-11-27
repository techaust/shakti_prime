import * as SecureStore from 'expo-secure-store';

/**
 * What the app keeps between launches, all in expo-secure-store, which seals each value with a key
 * held in the Android Keystore (docs/07-security.md §2): the refresh token, the installation's id,
 * the PIN and its wrong tries, and the person's name and email for the screens while offline. The
 * access token lives in memory only, and nothing is kept in the app's plain storage.
 */
const KEYS = {
  refreshToken: 'shakti.refresh_token',
  deviceId: 'shakti.device_id',
  pin: 'shakti.pin',
  pinTries: 'shakti.pin_tries',
  person: 'shakti.person',
} as const;

/** Readable only while the phone is unlocked, and never copied to another phone by a backup. */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface StoredPerson {
  name: string;
  email: string;
}

const get = (key: string) => SecureStore.getItemAsync(key, OPTIONS);
const set = (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS);
const remove = (key: string) => SecureStore.deleteItemAsync(key, OPTIONS);

/** 128 random bits as a UUID (version 4), from the platform's random source where it has one. */
function randomUuid(): string {
  const bytes = new Uint8Array(16);
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } })
    .crypto;
  if (source?.getRandomValues !== undefined) source.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const tokenStore = {
  /** The installation's id, made on first use and kept until the app is removed. */
  async deviceId(): Promise<string> {
    const existing = await get(KEYS.deviceId);
    if (existing !== null) return existing;
    const made = randomUuid();
    await set(KEYS.deviceId, made);
    return made;
  },
  refreshToken: () => get(KEYS.refreshToken),
  saveRefreshToken: (token: string) => set(KEYS.refreshToken, token),
  pin: () => get(KEYS.pin),
  savePin: async (pin: string) => {
    await set(KEYS.pin, pin);
    await remove(KEYS.pinTries);
  },
  async pinTries(): Promise<number> {
    const value = Number(await get(KEYS.pinTries));
    return Number.isInteger(value) && value > 0 ? value : 0;
  },
  savePinTries: (tries: number) => set(KEYS.pinTries, String(tries)),
  async person(): Promise<StoredPerson | null> {
    const raw = await get(KEYS.person);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as Partial<StoredPerson>;
      return typeof value.name === 'string' && typeof value.email === 'string'
        ? { name: value.name, email: value.email }
        : null;
    } catch {
      return null;
    }
  },
  savePerson: (person: StoredPerson) => set(KEYS.person, JSON.stringify(person)),
  /** Signs the phone out: every value but the installation's id is removed. */
  async clear(): Promise<void> {
    await Promise.all([
      remove(KEYS.refreshToken),
      remove(KEYS.pin),
      remove(KEYS.pinTries),
      remove(KEYS.person),
    ]);
  },
};
