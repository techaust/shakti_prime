import { defineConfig } from 'vitest/config';

// Pure unit tests only. Anything touching Postgres lives under tests/ and runs via test:security.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
