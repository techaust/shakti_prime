import { defineConfig } from 'vitest/config';

// Command tests on real Postgres: permission denied, wrong entity, happy path (AGENTS.md §7).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
