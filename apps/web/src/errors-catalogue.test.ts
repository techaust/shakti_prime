import { ERROR_CODES } from '@shakti/contracts';
import { commands, RUNNER_REASONS } from '@shakti/domain';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import { REASONS } from './auth/errors';

const here = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Every `reason: '…'` a domain error or an action names in the source. */
function reasonsInSource(): string[] {
  const roots = [join(here, '../../../packages/domain/src'), here];
  const found = new Set<string>();
  for (const file of roots.flatMap(sourceFiles)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/reason: '([a-z_]+)'/g)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found].sort();
}

describe('every error a person can meet has a sentence (AUDIT M30)', () => {
  const catalogue: Readonly<Record<string, unknown>> = en.errors;

  it('every error code', () => {
    for (const code of ERROR_CODES) expect(catalogue, code).toHaveProperty(code);
  });

  it('every reason the runner gives and every constraint a command names', () => {
    const named = Object.values(commands).flatMap((c) => Object.values(c.constraintReasons ?? {}));
    for (const reason of [...RUNNER_REASONS, ...named]) {
      expect(catalogue, reason).toHaveProperty(reason);
    }
  });

  it('every reason written in the domain and web source, and every auth reason', () => {
    const reasons = [...reasonsInSource(), ...Object.values(REASONS).map((r) => r.reason)];
    expect(reasons.length).toBeGreaterThan(20);
    const missing = reasons.filter((reason) => !(reason in catalogue));
    expect(missing).toEqual([]);
  });
});
