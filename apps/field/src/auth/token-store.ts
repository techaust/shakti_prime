import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * What the app keeps between launches, all in expo-secure-store, which seals each value with a key
 * held in the Android Keystore (docs/07-security.md §2): the refresh token, the installation's id
 * (a random UUID from expo-crypto), the PIN as a salted SHA-256 and its wrong tries, and the
 * person's name and email for the screens while offline. The access token lives in memory only,
 * and nothing is kept in the app's plain storage.
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

/** The PIN's stored form: a random salt and the SHA-256 of the salt and the PIN, in hex. */
const PIN_FORMAT = /^v1:([0-9a-f]{32}):([0-9a-f]{64})$/;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const pinDigest = (salt: string, pin: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`, {
    encoding: Crypto.CryptoEncoding.HEX,
  });

/** Two hex digests compared in full, whatever their first difference. */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export const tokenStore = {
  /** The installation's id, made on first use and kept until the app is removed. */
  async deviceId(): Promise<string> {
    const existing = await get(KEYS.deviceId);
    if (existing !== null) return existing;
    const made = Crypto.randomUUID();
    await set(KEYS.deviceId, made);
    return made;
  },
  refreshToken: () => get(KEYS.refreshToken),
  saveRefreshToken: (token: string) => set(KEYS.refreshToken, token),
  /** Whether a PIN has been chosen on this phone since the person signed in. */
  hasPin: async () => (await get(KEYS.pin)) !== null,
  /** Keeps the PIN as a salted SHA-256, never as typed, and starts its wrong tries again. */
  savePin: async (pin: string) => {
    const salt = hex(Crypto.getRandomBytes(16));
    await set(KEYS.pin, `v1:${salt}:${await pinDigest(salt, pin)}`);
    await remove(KEYS.pinTries);
  },
  /** Whether the PIN typed is the one chosen; false when none is kept or it cannot be read. */
  async pinMatches(pin: string): Promise<boolean> {
    const stored = PIN_FORMAT.exec((await get(KEYS.pin)) ?? '');
    if (stored === null) return false;
    const [, salt = '', digest = ''] = stored;
    return sameDigest(await pinDigest(salt, pin), digest);
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
