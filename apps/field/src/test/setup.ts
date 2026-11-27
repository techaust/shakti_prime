// The native modules the screens and stores use, mocked for jest-expo: the secure store as an
// in-memory map per test, the fingerprint check as never available unless a test says otherwise.
// Jest 30.5 leaves Expo's lazy globals alone at teardown, so no workaround is needed for them.
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
    __values: values,
  };
});

/** The part of Node's crypto the expo-crypto mock uses. */
interface MockNodeCrypto {
  randomUUID(): string;
  randomBytes(count: number): Uint8Array;
  createHash(algorithm: string): { update(data: string): { digest(encoding: 'hex'): string } };
}

// expo-crypto's native module, with Node's own random source and SHA-256 in its place.
jest.mock('expo-crypto', () => {
  const node = jest.requireActual('node:crypto') as MockNodeCrypto;
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex' },
    randomUUID: jest.fn(() => node.randomUUID()),
    getRandomBytes: jest.fn((count: number) => new Uint8Array(node.randomBytes(count))),
    digestStringAsync: jest.fn((_algorithm: string, data: string) =>
      Promise.resolve(node.createHash('sha256').update(data).digest('hex')),
    ),
  };
});

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(() => Promise.resolve(false)),
  isEnrolledAsync: jest.fn(() => Promise.resolve(false)),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: false })),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', extra: { apiBaseUrl: 'https://bos.test/api/v1' } } },
}));

jest.mock(
  'react-native-safe-area-context',
  () =>
    (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: unknown })
      .default,
);
