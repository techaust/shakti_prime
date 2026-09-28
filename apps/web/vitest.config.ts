import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next.js keeps JSX for its own compiler (`jsx: preserve`); the component tests render it.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
