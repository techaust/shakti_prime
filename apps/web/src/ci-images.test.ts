import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The container images CI, the local stack and the Linux screenshot runs use (audit OPS-19): each
// named by its tag and pinned by its digest, so a tag moved on the registry never changes what the
// suites run on, and every copy names the same image. They move by hand, all copies together.

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');
const SOURCES = ['.github/workflows/ci.yml', 'compose.yaml', 'apps/web/e2e/setup/snap-in-linux.ts'];

function references(image: string): { path: string; reference: string }[] {
  const pattern = new RegExp(`${image.replaceAll('.', '\\.')}[^\\s'"]*`, 'g');
  return SOURCES.flatMap((path) =>
    [...read(path).matchAll(pattern)].map((match) => ({ path, reference: match[0] })),
  );
}

const PINNED = /^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/;

describe('the container images', () => {
  it('pin the Postgres image by digest, the same one everywhere', () => {
    const found = references('supabase/postgres');
    expect(found.map((f) => f.path)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/ci.yml',
      '.github/workflows/ci.yml',
      'compose.yaml',
    ]);
    for (const { reference } of found) expect(reference).toMatch(PINNED);
    expect(new Set(found.map((f) => f.reference)).size).toBe(1);
  });

  it('pin the Playwright image by digest, the same one everywhere, at the version of @playwright/test', () => {
    const found = references('mcr.microsoft.com/playwright');
    expect(found.map((f) => f.path)).toEqual([
      '.github/workflows/ci.yml',
      'apps/web/e2e/setup/snap-in-linux.ts',
    ]);
    for (const { reference } of found) expect(reference).toMatch(PINNED);
    expect(new Set(found.map((f) => f.reference)).size).toBe(1);
    const manifest = JSON.parse(read('apps/web/package.json')) as {
      devDependencies: Record<string, string>;
    };
    const version = manifest.devDependencies['@playwright/test']?.replace(/^[~^]/, '');
    expect(found[0]?.reference).toContain(`:v${String(version)}-`);
  });
});
