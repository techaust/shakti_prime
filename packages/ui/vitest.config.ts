import { defineConfig } from 'vitest/config';

// Components render to static markup in Node, so the tests need no browser environment.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
