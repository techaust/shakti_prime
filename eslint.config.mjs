// Root ESLint configuration for the whole monorepo (AGENTS.md §4).
// Type-aware rules run against each workspace's own tsconfig through projectService.
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The raw database client is imported only inside packages/db. Everything else goes through
// withRequestContext() so RLS settings are always present (CLAUDE.md, ADR 0002, ADR 0004).
const rawClientImport = {
  paths: [
    {
      name: '@shakti/db/client',
      message:
        'Use withRequestContext() from @shakti/db. The raw client is restricted to packages/db/src.',
    },
  ],
  patterns: [
    {
      group: ['**/db/src/client', '**/db/src/client.js', '**/db/src/client.ts'],
      message:
        'Use withRequestContext() from @shakti/db. The raw client is restricted to packages/db/src.',
    },
  ],
};

// packages/domain and packages/contracts never import a framework (AGENTS.md §3).
const frameworkImports = {
  ...rawClientImport,
  patterns: [
    ...rawClientImport.patterns,
    {
      group: ['next', 'next/*', 'react', 'react/*', 'react-dom', 'react-dom/*', 'expo', 'expo-*'],
      message: 'packages/domain and packages/contracts have no framework imports (AGENTS.md §3).',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.claude/skills/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: true },
      ],
      'no-restricted-imports': ['error', rawClientImport],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['packages/db/src/**/*.ts', 'packages/db/seeds/**/*.ts', 'packages/db/tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/contracts/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', frameworkImports] },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [...nextVitals, ...nextTs],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    settings: { next: { rootDir: 'apps/web' } },
  },
  {
    files: [
      '**/*.{js,mjs,cjs}',
      '**/scripts/**/*.ts',
      'tools/**/*.ts',
      'packages/db/seeds/**/*.ts',
      'packages/db/src/migrate.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
