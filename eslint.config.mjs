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
    {
      name: '@shakti/db/testing',
      message:
        'The testing helpers open owner and context-free connections. They are for tests only.',
    },
    {
      name: '@shakti/db/auth',
      message:
        'The auth_service connection belongs to the auth module (apps/web/src/auth) and its tests.',
    },
    {
      name: '@shakti/db/bootstrap',
      message: 'The bootstrap writes as the table owner. Scripts only.',
    },
  ],
  patterns: [
    {
      group: [
        '**/db/src/client',
        '**/db/src/client.js',
        '**/db/src/client.ts',
        '**/db/src/testing',
        '**/db/src/testing/*',
        '**/db/src/auth-client',
        '**/db/src/auth-client.ts',
        '**/db/src/bootstrap',
        '**/db/src/bootstrap.ts',
      ],
      message:
        'Use withRequestContext() from @shakti/db. The raw client and the testing helpers are restricted to packages/db/src and test files.',
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
    files: [
      'packages/db/src/**/*.ts',
      'packages/db/seeds/**/*.ts',
      'packages/db/tests/**/*.ts',
      '**/tests/**/*.ts',
      '**/*.test.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/contracts/**/*.ts'],
    ignores: ['**/tests/**', '**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', frameworkImports] },
  },
  {
    // The auth module is the one caller of the auth_service connection (docs/DATABASE.md §3).
    files: ['apps/web/src/auth/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: rawClientImport.paths.filter((p) => p.name !== '@shakti/db/auth'),
          patterns: rawClientImport.patterns,
        },
      ],
    },
  },
  {
    // Command-line scripts may bootstrap the first user and build an auth instance.
    files: ['apps/web/scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: rawClientImport.paths.filter(
            (p) => p.name !== '@shakti/db/auth' && p.name !== '@shakti/db/bootstrap',
          ),
          patterns: rawClientImport.patterns,
        },
      ],
    },
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
