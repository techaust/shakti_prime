// The import fences of eslint.config.mjs (AUDIT M12), checked against source text linted under
// paths that do not exist, so nothing is written to the repository. Type information is not needed
// for the two rules the fences use, and a path the TypeScript project does not know has none.
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({
  cwd: root,
  overrideConfig: tseslint.configs.disableTypeChecked,
  ruleFilter: ({ ruleId }) =>
    ruleId === 'no-restricted-imports' || ruleId === 'no-restricted-syntax',
});

async function fences(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `parse: ${m.message}`);
}

const WEB = 'apps/web/src/actions/fence-probe.ts';
const DOMAIN = 'packages/domain/src/fence-probe.ts';

describe('the import fences', { timeout: 60_000 }, () => {
  it('pass ordinary code', async () => {
    expect(
      await fences(WEB, "import { newId } from '@shakti/contracts';\nexport const a = newId;\n"),
    ).toEqual([]);
    expect(await fences(DOMAIN, 'export const a = 1;\n')).toEqual([]);
  });

  it('keep the schema out of apps/web by either of its names', async () => {
    expect(
      await fences(WEB, "import { schema } from '@shakti/db';\nexport const s = schema;\n"),
    ).toEqual(['no-restricted-imports']);
    expect(
      await fences(WEB, "import * as s from '@shakti/db/schema';\nexport const t = s;\n"),
    ).toEqual(['no-restricted-imports']);
    expect(await fences(WEB, "export const s = () => import('@shakti/db/schema');\n")).toEqual([
      'no-restricted-syntax',
    ]);
    expect(await fences(WEB, "export const s = () => import('@shakti/db');\n")).toEqual([
      'no-restricted-syntax',
    ]);
  });

  it('keep the domain testing settings out of everything but tests', async () => {
    for (const file of [WEB, DOMAIN]) {
      expect(
        await fences(
          file,
          "import { importBatchSettings } from '@shakti/domain/testing';\nexport const s = importBatchSettings;\n",
        ),
      ).toEqual(['no-restricted-imports']);
      expect(
        await fences(file, "export const s = () => import('@shakti/domain/testing');\n"),
      ).toEqual(['no-restricted-syntax']);
    }
    // Nor are they reached by a relative path to the module that holds them, static or dynamic.
    for (const file of ['testing', 'imports/batch-settings']) {
      expect(
        await fences(
          WEB,
          `import * as m from '../../../../packages/domain/src/${file}';\nexport const s = m;\n`,
        ),
      ).toEqual(['no-restricted-imports']);
      expect(
        await fences(
          WEB,
          `export const s = () => import('../../../../packages/domain/src/${file}');\n`,
        ),
      ).toEqual(['no-restricted-syntax']);
    }
    expect(
      await fences(
        'packages/domain/tests/commands/fence-probe.test.ts',
        "import { importBatchSettings } from '@shakti/domain/testing';\nexport const s = importBatchSettings;\n",
      ),
    ).toEqual([]);
  });

  it('let only the batch command and the testing module read the import batch settings', async () => {
    const reads =
      "import { importBatchSettings } from '__PATH__';\nexport const s = importBatchSettings;\n";
    expect(
      await fences(
        'packages/domain/src/commands/crm/fence-probe.ts',
        reads.replace('__PATH__', '../../imports/batch-settings'),
      ),
    ).toEqual(['no-restricted-imports']);
    expect(
      await fences(
        'packages/domain/src/imports/fence-probe.ts',
        reads.replace('__PATH__', './batch-settings'),
      ),
    ).toEqual(['no-restricted-imports']);
    expect(
      await fences(
        'packages/domain/src/imports/fence-probe.ts',
        "export const s = () => import('./batch-settings');\n",
      ),
    ).toEqual(['no-restricted-syntax']);
    // Nor the testing module that hands them out, by a relative path from product code.
    expect(
      await fences(
        'packages/domain/src/commands/crm/fence-probe.ts',
        reads.replace('__PATH__', '../../testing'),
      ),
    ).toEqual(['no-restricted-imports']);
    expect(
      await fences('packages/domain/src/fence-probe.ts', reads.replace('__PATH__', './testing')),
    ).toEqual(['no-restricted-imports']);
    expect(
      await fences(
        'packages/domain/src/commands/imports/commit-job.ts',
        reads.replace('__PATH__', '../../imports/batch-settings'),
      ),
    ).toEqual([]);
    expect(
      await fences(
        'packages/domain/src/testing.ts',
        "export { importBatchSettings } from './imports/batch-settings';\n",
      ),
    ).toEqual([]);
  });

  it('leave a module named testing elsewhere alone', async () => {
    for (const file of [
      'apps/web/src/actions/fence-probe.ts',
      'packages/contracts/src/fence-probe.ts',
      'tools/copy-lint/src/fence-probe.ts',
    ]) {
      expect(await fences(file, "export const t = () => import('./testing');\n")).toEqual([]);
    }
  });

  it('keep apps/web out of packages/db/src by a relative path', async () => {
    expect(
      await fences(
        WEB,
        "import { withRequestContext } from '../../../../packages/db/src/context';\nexport const w = withRequestContext;\n",
      ),
    ).toEqual(['no-restricted-imports']);
    expect(
      await fences(WEB, "export const w = () => import('../../../../packages/db/src/context');\n"),
    ).toEqual(['no-restricted-syntax']);
  });

  it('refuse a fenced database file named by a relative path, static or dynamic', async () => {
    for (const file of [
      'client',
      'auth-client',
      'outbox-client',
      'bootstrap',
      'testing/index',
      'auth/user-grants',
    ]) {
      expect(
        await fences(DOMAIN, `export const f = () => import('../../db/src/${file}');\n`),
      ).toEqual(['no-restricted-syntax']);
      expect(
        await fences(DOMAIN, `import * as m from '../../db/src/${file}';\nexport const f = m;\n`),
      ).toEqual(['no-restricted-imports']);
    }
    expect(
      await fences(WEB, "export const c = () => import('../../../../packages/db/src/client');\n"),
    ).toContain('no-restricted-syntax');
  });

  it('let packages/db reach its own files', async () => {
    expect(
      await fences(
        'packages/db/src/fence-probe.ts',
        "export const c = () => import('./client');\n",
      ),
    ).toEqual([]);
  });

  it('refuse require under another name and createRequire outside tests', async () => {
    expect(await fences(DOMAIN, "export const load = require('postgres');\n")).toEqual([
      'no-restricted-syntax',
    ]);
    expect(await fences(DOMAIN, 'const r = require;\nexport const load = r;\n')).toEqual([
      'no-restricted-syntax',
    ]);
    expect(await fences(DOMAIN, 'export const load = module.require;\n')).toEqual([
      'no-restricted-syntax',
    ]);
    expect(
      await fences(
        DOMAIN,
        "import { createRequire } from 'node:module';\nexport const load = createRequire(import.meta.url);\n",
      ),
    ).toContain('no-restricted-syntax');
    expect(
      await fences(WEB, "import * as m from 'module';\nexport const load = m.createRequire;\n"),
    ).toContain('no-restricted-syntax');
    expect(await fences(WEB, "export const load = () => import('node:module');\n")).toEqual([
      'no-restricted-syntax',
    ]);
  });
});
