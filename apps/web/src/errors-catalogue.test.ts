import { ERROR_CODES, ImportRowErrorCodeSchema, LeadImportFieldSchema } from '@shakti/contracts';
import { commands, MACHINE_REASONS, RUNNER_REASONS } from '@shakti/domain';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import { REASONS } from './auth/errors';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Files whose `reason: '…'` is not a reason a person meets. The recorded API examples carry a
 * provider's own field of that name (a sync conflict's `state_changed`), which the screens never
 * show as an error.
 */
const NOT_ERROR_REASONS = new Set([join(here, '../../../packages/contracts/src/api/fixtures.ts')]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') && !NOT_ERROR_REASONS.has(path)
      ? [path]
      : [];
  });
}

/** Every `reason: '…'` a domain error, a contract, the database layer or an action names. */
function reasonsInSource(): string[] {
  const roots = [
    join(here, '../../../packages/domain/src'),
    join(here, '../../../packages/contracts/src'),
    join(here, '../../../packages/db/src'),
    here,
  ];
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

  it('every illegal-move reason of the state machines', () => {
    expect(MACHINE_REASONS.length).toBeGreaterThan(0);
    for (const reason of MACHINE_REASONS) expect(catalogue, reason).toHaveProperty(reason);
  });

  it('every finding on an import row, and every field it can name', () => {
    for (const code of ImportRowErrorCodeSchema.options) {
      expect(en.imports.rowErrors, code).toHaveProperty(code);
    }
    for (const field of [...LeadImportFieldSchema.options, 'row']) {
      expect(en.imports.fields, field).toHaveProperty(field);
    }
  });

  it('leaves out only the recorded API examples, which the scan would otherwise read', () => {
    for (const file of NOT_ERROR_REASONS) {
      expect(readFileSync(file, 'utf8')).toMatch(/reason: '[a-z_]+'/);
    }
  });

  it('every reason written in the domain, contracts, database and web source, and every auth reason', () => {
    const reasons = [...reasonsInSource(), ...Object.values(REASONS).map((r) => r.reason)];
    expect(reasons.length).toBeGreaterThan(20);
    const missing = reasons.filter((reason) => !(reason in catalogue));
    expect(missing).toEqual([]);
  });
});
