import { defineConfig } from 'vitest/config';

// Route tests that need Postgres (readiness). The database is migrated by the db suite's setup.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
