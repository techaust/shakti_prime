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
    // The settings tests change (an import batch's time and log) would change every request's.
    {
      name: '@shakti/domain/testing',
      message:
        'The domain testing settings change how every request runs. They are for tests only.',
    },
    // app.user_grants() answers for any user before a request context exists: it builds the
    // principal, so only the code that resolves one may call it.
    {
      name: '@shakti/db/grants',
      message:
        "Loading a user's grants belongs to principal resolution (apps/web/src/auth) and the import worker.",
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
        '**/db/src/auth/user-grants',
        '**/db/src/auth/user-grants.ts',
      ],
      message:
        'Use withRequestContext() from @shakti/db. The raw client and the testing helpers are restricted to packages/db/src and test files.',
    },
    {
      group: [
        '**/domain/src/testing',
        '**/domain/src/testing.ts',
        '**/domain/src/imports/batch-settings',
        '**/domain/src/imports/batch-settings.ts',
      ],
      message:
        'The domain testing settings change how every request runs. Tests reach them through @shakti/domain/testing.',
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
// The schema is also exported on its own path; it would let a screen build a write just the same.
const webSchemaModule = {
  name: '@shakti/db/schema',
  message: 'apps/web uses executeCommand() and executeQuery() from @shakti/domain (AUDIT M12).',
};
const webDatabasePaths = [webDatabaseNames, webSchemaModule];
// A relative path into packages/db reaches the request context and the schema without the
// package's name, so apps/web names no file there at all.
const webDatabasePatterns = [
  ...rawClientImport.patterns,
  {
    group: ['**/db/src', '**/db/src/**'],
    message: 'apps/web uses executeCommand() and executeQuery() from @shakti/domain (AUDIT M12).',
  },
];

// The restricted modules may not be reached by a dynamic import or require either (AUDIT M12).
const restrictedModule =
  '/^(@shakti\\/db\\/(client|testing|auth|outbox|bootstrap|grants)|@shakti\\/domain\\/testing|postgres|drizzle-orm\\/postgres-js)$/';
// The same files named by a relative path into packages/db/src rather than by the package name.
const restrictedFile =
  '/(^|\\/)db\\/src\\/(client|auth-client|outbox-client|bootstrap|testing|auth\\/user-grants)(\\.[cm]?[jt]s)?(\\/|$)/';

// The domain's testing settings, named by a relative path through packages/domain/src, which a
// dynamic import could reach without the package name.
const restrictedDomainFile =
  '/(^|\\/)domain\\/src\\/(testing|imports\\/batch-settings)(\\.[cm]?[jt]s)?$/';

// The same modules named relative to a file inside packages/domain/src (see the domain block).
const domainRelativeSettingsImport = {
  selector:
    'ImportExpression[source.value=/^\\.{1,2}\\/(\\.\\.\\/)*(imports\\/)?(testing|batch-settings)(\\.[cm]?[jt]s)?$/]',
  message: 'A dynamic import of the domain testing settings passes around the import fences.',
};

const restrictedSyntax = [
  // Relative imports carry no `.js` extension: Turbopack does not resolve them (CLAUDE.md).
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
    selector: `ImportExpression[source.value=${restrictedFile}]`,
    message: 'A dynamic import of a database file passes around the import fences.',
  },
  {
    selector: `ImportExpression[source.value=${restrictedDomainFile}]`,
    message: 'A dynamic import of the domain testing settings passes around the import fences.',
  },
  {
    selector: "CallExpression[callee.name='require']",
    message: 'Use import; require() passes around the import fences.',
  },
];

// require reached another way (a copy under another name, module.require, createRequire) loads
// any module without a trace of its name in an import, so outside tests none of them appears.
const requireBypasses = [
  {
    selector: "Identifier[name='require']:not(CallExpression > Identifier.callee)",
    message: 'Use import; require() under any name passes around the import fences.',
  },
  {
    selector: "Identifier[name='createRequire']",
    message: 'Use import; createRequire() builds a require() that passes around the import fences.',
  },
  {
    selector: 'ImportDeclaration[source.value=/^(node:)?module$/]',
    message:
      'Use import; the module package builds a require() that passes around the import fences.',
  },
  {
    selector: 'ImportExpression[source.value=/^(node:)?module$/]',
    message:
      'Use import; the module package builds a require() that passes around the import fences.',
  },
];

// apps/web: the database package and its schema are not reached by a dynamic import either, since
// importNames reads only static import names, nor is any file of packages/db/src.
const webDatabaseImport = {
  selector: 'ImportExpression[source.value=/^@shakti\\/db(\\/schema)?$|(^|\\/)db\\/src(\\/|$)/]',
  message: 'apps/web uses executeCommand() and executeQuery() from @shakti/domain (AUDIT M12).',
};

// The fences above read the specifier as written, so a built one (a template, a variable, a
// concatenation) would pass around them: outside tests, a dynamic import names its module
// as a plain string.
const nonLiteralImport = {
  selector: "ImportExpression[source.type!='Literal']",
  message:
    'A dynamic import names its module as a plain string; a built specifier passes around the import fences.',
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

// Every module of @shakti/contracts loads Zod, about 90 kB (gzip) a phone would download on every
// screen (BLUEPRINT §11.4, the per-page JavaScript budget in apps/web/js-budget.json). Code that
// runs in the browser takes only types from the contracts (`import type`, which the build erases);
// the values it needs are copied in apps/web/src/screens/contract-values.ts, whose test keeps them
// equal to the contracts. The rule checks every 'use client' file, and with `everyFile` every file
// of the folders whose modules the browser loads.
const CONTRACTS_MODULE = /^@shakti\/contracts(\/|$)/;
const browserContractTypes = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { everyFile: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      value:
        'Browser code imports only types from @shakti/contracts (every module of it loads Zod). Use `import type`, and take a value from apps/web/src/screens/contract-values.ts.',
    },
  },
  create(context) {
    const everyFile = context.options[0]?.everyFile === true;
    const prologue = [];
    for (const statement of context.sourceCode.ast.body) {
      if (statement.type !== 'ExpressionStatement' || typeof statement.directive !== 'string')
        break;
      prologue.push(statement.directive);
    }
    if (!everyFile && !prologue.includes('use client')) return {};
    const check = (node, kind) => {
      if (node.source && CONTRACTS_MODULE.test(String(node.source.value)) && kind !== 'type') {
        context.report({ node, messageId: 'value' });
      }
    };
    return {
      ImportDeclaration: (node) => {
        check(node, node.importKind);
      },
      ExportNamedDeclaration: (node) => {
        check(node, node.exportKind);
      },
      ExportAllDeclaration: (node) => {
        check(node, node.exportKind);
      },
      ImportExpression: (node) => {
        check(node, 'value');
      },
    };
  },
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
      'no-restricted-syntax': ['error', ...restrictedSyntax, nonLiteralImport, ...requireBypasses],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Tests may build a specifier (a fixture per case, a module reloaded under test).
    files: ['packages/*/tests/**/*.ts', 'apps/*/tests/**/*.ts', '**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...restrictedSyntax] },
  },
  {
    files: [
      'packages/db/src/**/*.ts',
      'packages/db/seeds/**/*.ts',
      'packages/*/tests/**/*.ts',
      'apps/*/tests/**/*.ts',
      '**/*.test.ts',
      // The end-to-end seed runs on the host before the journeys and makes their people.
      'apps/web/e2e/setup/**/*.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/contracts/**/*.ts'],
    ignores: ['**/tests/**', '**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', frameworkImports] },
  },
  {
    // Inside the domain, only the batch command reads the import batch settings and only the
    // testing module hands them to tests.
    files: ['packages/domain/src/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      'packages/domain/src/commands/imports/commit-job.ts',
      'packages/domain/src/testing.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...frameworkImports,
          patterns: [
            ...frameworkImports.patterns,
            {
              regex: '(^|/)batch-settings(\\.[cm]?[jt]s)?$',
              message:
                'Only commit-job.ts reads the import batch settings; tests reach them through @shakti/domain/testing.',
            },
            {
              // The testing module (src/testing.ts) serves tests only, by a relative path too.
              regex: '^\\.{1,2}/(\\.\\./)*testing(\\.[cm]?[jt]s)?$',
              message:
                'The domain testing module serves tests only; product code never imports it.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        nonLiteralImport,
        ...requireBypasses,
        domainRelativeSettingsImport,
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [...rawClientImport.paths, ...webDatabasePaths], patterns: webDatabasePatterns },
      ],
    },
  },
  {
    // The auth module is the one caller of the auth_service connection (docs/DATABASE.md §3),
    // and resolves the principal from the user's grants.
    files: ['apps/web/src/auth/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...rawClientImport.paths.filter(
              (p) => p.name !== '@shakti/db/auth' && p.name !== '@shakti/db/grants',
            ),
            ...webDatabasePaths,
          ],
          patterns: webDatabasePatterns,
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
            ...webDatabasePaths,
          ],
          patterns: webDatabasePatterns,
        },
      ],
    },
  },
  {
    // The import worker resolves the person who asked for the commit as they stand now.
    files: ['apps/web/src/workers/imports.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...rawClientImport.paths.filter(
              (p) => p.name !== '@shakti/db/outbox' && p.name !== '@shakti/db/grants',
            ),
            ...webDatabasePaths,
          ],
          patterns: webDatabasePatterns,
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
            ...webDatabasePaths,
          ],
          patterns: webDatabasePatterns,
        },
      ],
    },
  },
  {
    // apps/web reaches the database package by no dynamic import either (webDatabaseImport).
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/scripts/**/*.ts'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        nonLiteralImport,
        ...requireBypasses,
        webDatabaseImport,
      ],
    },
  },
  {
    // Browser code takes only types from the contracts (see browserContractTypes above).
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { shakti: { rules: { 'browser-contract-types': browserContractTypes } } },
    rules: { 'shakti/browser-contract-types': 'error' },
  },
  {
    // The folders whose modules client components import, with or without 'use client'. The
    // shell's grant checks run on the server, in screens/menu-access.ts, as do the page guards.
    files: [
      'apps/web/src/components/**/*.{ts,tsx}',
      'apps/web/src/screens/**/*.ts',
      'apps/web/src/nav.ts',
      'apps/web/src/theme.ts',
      'packages/ui/src/**/*.{ts,tsx}',
    ],
    ignores: [
      '**/*.test.{ts,tsx}',
      'apps/web/src/screens/access.ts',
      'apps/web/src/screens/menu-access.ts',
    ],
    rules: { 'shakti/browser-contract-types': ['error', { everyFile: true }] },
  },
  {
    // The web components follow the same React, hooks and accessibility rules as the app.
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    extends: [...nextVitals, ...nextTs],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    settings: { next: { rootDir: 'apps/web' } },
  },
  {
    // Every word a user reads comes from the message catalogue, where the copy lint checks it
    // (DESIGN.md §11.4); text written straight into JSX would bypass it (AUDIT L32).
    files: [
      'apps/web/src/app/**/*.tsx',
      'apps/web/src/components/**/*.tsx',
      'packages/ui/src/**/*.tsx',
    ],
    ignores: ['**/*.test.tsx'],
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
