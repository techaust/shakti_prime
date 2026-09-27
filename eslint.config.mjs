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
      name: '@shakti/db/outbox',
      message:
        'The outbox_publisher connection belongs to the outbox workers (apps/web/src/workers) and its tests.',
    },
    {
      name: '@shakti/db/bootstrap',
      message: 'The bootstrap writes as the table owner. Scripts only.',
    },
    // A connection opened by hand would skip the request context and RLS settings (AUDIT M12).
    {
      name: 'postgres',
      message: 'Database connections are opened only in packages/db.',
    },
    {
      name: 'drizzle-orm/postgres-js',
      message: 'Database connections are opened only in packages/db.',
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
        '**/db/src/outbox-client',
        '**/db/src/outbox-client.ts',
        '**/db/src/bootstrap',
        '**/db/src/bootstrap.ts',
      ],
      message:
        'Use withRequestContext() from @shakti/db. The raw client and the testing helpers are restricted to packages/db/src and test files.',
    },
  ],
};

// apps/web reaches the database only through the domain package: executeCommand() runs the
// guard, the strict DTO and the audit and outbox hooks; executeQuery() runs a domain query
// (AUDIT M12). The request context and the schema would let a screen write around them.
const webDatabaseNames = {
  name: '@shakti/db',
  importNames: ['withRequestContext', 'schema', 'entityIdsLiteral'],
  message: 'apps/web uses executeCommand() and executeQuery() from @shakti/domain (AUDIT M12).',
};

// The restricted modules may not be reached by a dynamic import or require either (AUDIT M12).
const restrictedModule =
  '/^(@shakti\\/db\\/(client|testing|auth|outbox|bootstrap)|postgres|drizzle-orm\\/postgres-js)$/';

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
      '**/.claude/worktrees/**',
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
      // Relative imports carry no `.js` extension: Turbopack does not resolve them (CLAUDE.md).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/]',
          message: 'Relative imports have no .js extension (Turbopack does not resolve them).',
        },
        {
          selector: 'ExportAllDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/]',
          message: 'Relative imports have no .js extension (Turbopack does not resolve them).',
        },
        {
          selector: 'ExportNamedDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/]',
          message: 'Relative imports have no .js extension (Turbopack does not resolve them).',
        },
        {
          selector: `ImportExpression[source.value=${restrictedModule}]`,
          message: 'A dynamic import of a database module passes around the import fences.',
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: 'Use import; require() passes around the import fences.',
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: [
      'packages/db/src/**/*.ts',
      'packages/db/seeds/**/*.ts',
      'packages/*/tests/**/*.ts',
      'apps/*/tests/**/*.ts',
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
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [...rawClientImport.paths, webDatabaseNames], patterns: rawClientImport.patterns },
      ],
    },
  },
  {
    // The auth module is the one caller of the auth_service connection (docs/DATABASE.md §3).
    files: ['apps/web/src/auth/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...rawClientImport.paths.filter((p) => p.name !== '@shakti/db/auth'),
            webDatabaseNames,
          ],
          patterns: rawClientImport.patterns,
        },
      ],
    },
  },
  {
    // The outbox workers are the one caller of the outbox_publisher connection (DATABASE §3).
    files: ['apps/web/src/workers/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...rawClientImport.paths.filter((p) => p.name !== '@shakti/db/outbox'),
            webDatabaseNames,
          ],
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
          paths: [
            ...rawClientImport.paths.filter(
              (p) => p.name !== '@shakti/db/auth' && p.name !== '@shakti/db/bootstrap',
            ),
            webDatabaseNames,
          ],
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
    // Every word a user reads comes from the message catalogue, where the copy lint checks it
    // (DESIGN.md §11.4); text written straight into JSX would bypass it (AUDIT L32).
    files: ['apps/web/src/app/**/*.tsx', 'apps/web/src/components/**/*.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        { noStrings: false, ignoreProps: true, allowedStrings: ['·', '—', '/', ':'] },
      ],
    },
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
