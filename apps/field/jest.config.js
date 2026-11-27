// jest-expo for Android (ADR 0012): the screens and the stores run against React Native's test
// renderer, with the native modules mocked. The workspace packages and the ESM-only packages they
// load are compiled like the app's own code.
module.exports = {
  preset: 'jest-expo/android',
  setupFiles: ['./src/test/setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|expo-router|nativewind|react-native-css-interop|uuid|zod))',
  ],
};
