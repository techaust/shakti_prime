import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The files that define the checks (owner, 13-10-2026): the merge workflow waits for the owner's
// `checks-ok` label when a pull request changes one, and the lapse workflow takes the label off
// when a later push does. Both must name the same files, so each keeps one copy of the rule.

const root = fileURLToPath(new URL('../../../', import.meta.url));

function checksPath(workflow: string): string[] {
  const text = readFileSync(`${root}.github/workflows/${workflow}`, 'utf8');
  const start = text.indexOf('def checks_path:');
  const end = text.indexOf(';', start);
  expect(start).toBeGreaterThan(0);
  return text
    .slice(start, end + 1)
    .split('\n')
    .map((line) => line.trim());
}

describe('the checks that wait for the owner', () => {
  it('are the same files in the merge workflow and the lapse workflow', () => {
    expect(checksPath('checks-ok-lapse.yml')).toEqual(checksPath('automerge.yml'));
  });

  it('name the files of the owner’s decision', () => {
    const rule = checksPath('automerge.yml').join(' ');
    for (const part of [
      '^\\\\.github/',
      'turbo\\\\.jsonc?$',
      '(vitest|playwright)',
      'eslint\\\\.config',
      '".gitleaksignore"',
      '"pnpm-workspace.yaml"',
      'js-budget\\\\.json$',
      'lighthouserc\\\\.json$',
    ]) {
      expect(rule).toContain(part);
    }
  });
});
