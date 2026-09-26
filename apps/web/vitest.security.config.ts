import { defineConfig } from 'vitest/config';

// Auth and route tests on real Postgres. The suite migrates and seeds its own database, so it
// does not depend on the order the workspaces run in.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
