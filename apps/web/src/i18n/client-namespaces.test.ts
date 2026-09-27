import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLIENT_NAMESPACES } from './client-namespaces';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith('.tsx') ? [path] : [];
  });
}

describe('messages sent to the browser (AUDIT L12)', () => {
  it('cover every namespace a client component or a component it renders translates', () => {
    const used = new Set<string>();
    for (const file of files(src)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/useTranslations\('([a-zA-Z]+)/g)) {
        if (match[1] !== undefined) used.add(match[1]);
      }
    }
    const shipped: readonly string[] = CLIENT_NAMESPACES;
    expect([...used].filter((ns) => !shipped.includes(ns))).toEqual([]);
  });
});
