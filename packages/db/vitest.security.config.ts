import { defineConfig } from 'vitest/config';

// Security suite on real Postgres (docs/SECURITY.md §11). globalSetup migrates and seeds first.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
