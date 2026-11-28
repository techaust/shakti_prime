import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The connector's own fences (AGENTS.md §3, docs/03-roadmap-appendix/phase5.md §6.2): its code
 * imports only `@shakti/contracts`, Node's built-in modules and its own files, never the database
 * or the domain; it never asks Tally to import or change anything; and it writes to the console
 * only through the log and the setup's prompter.
 */

const src = fileURLToPath(new URL('../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

const sources = files(src).map((path) => ({
  name: relative(src, path),
  text: readFileSync(path, 'utf8'),
}));

describe('the connector', () => {
  it('imports only the contracts, Node and its own files', () => {
    expect(sources.length).toBeGreaterThan(10);
    for (const { name, text } of sources) {
      const specifiers = [...text.matchAll(/\bfrom\s+'([^']+)'|\bimport\(\s*'([^']+)'\s*\)/g)].map(
        (m) => m[1] ?? m[2] ?? '',
      );
      for (const specifier of specifiers) {
        expect(
          specifier === '@shakti/contracts' ||
            specifier.startsWith('node:') ||
            /^\.{1,2}\//.test(specifier),
          `${name} imports ${specifier}`,
        ).toBe(true);
        expect(specifier, name).not.toMatch(/\.\.\/\.\.\/(?:\.\.\/)?(?:web|db|domain|packages)/);
      }
      expect(text, name).not.toMatch(/\brequire\(|createRequire/);
    }
  });

  it('never sends Tally an import or an alteration', () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(
        /TALLYREQUEST>\s*Import|ISMODIFY="Yes"|ACTION="(?:Create|Alter|Delete)"/i,
      );
    }
  });

  it('writes nothing to the console directly', () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/\bconsole\./);
    }
  });
});
