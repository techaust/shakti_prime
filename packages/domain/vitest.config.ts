import { defineConfig } from 'vitest/config';

// Pure unit tests: guards, calculators, state machines. Command tests against Postgres are under tests/.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
