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
    // One file at a time. Locally, with no queue configured, every command a server action runs
    // nudges the outbox publisher in process, which delivers any pending row in the shared
    // database: a file running beside `outbox-route.test.ts` could deliver the row that test
    // proves the route left alone. Sequential files keep each file's outbox rows its own.
    fileParallelism: false,
  },
});
