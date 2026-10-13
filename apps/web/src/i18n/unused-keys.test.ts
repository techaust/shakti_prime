import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Key groups reached only through a value the code reads at run time, never written out:
 * - `errors.` through a failure's reason (`errors-catalogue.test.ts` checks every reason has one);
 * - `roles.` through a role's seeded key;
 * - `imports.rowErrors.` through the code a checked import row carries.
 */
const REACHED_AT_RUN_TIME = ['errors.', 'roles.', 'imports.rowErrors.'] as const;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('the message catalogue (WEB-11)', () => {
  it('holds no message the code can never show', () => {
    const text = sources(src)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    // A key is written as its last name (`t('totalsHeading')`, `copy.buttons`) or reached
    // through a template whose fixed head names its group (`t(`state.${state}`)`).
    const words = new Set(text.match(/[A-Za-z_][A-Za-z0-9_]*/g));
    const heads = [...text.matchAll(/`([A-Za-z0-9_.]+\.)\$\{/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    const unused = leaves(en).filter((key) => {
      if (REACHED_AT_RUN_TIME.some((prefix) => key.startsWith(prefix))) return false;
      const names = key.split('.');
      if (words.has(names.at(-1) ?? '')) return false;
      return !names.some((_, at) => {
        const tail = names.slice(at).join('.');
        return heads.some((head) => tail.startsWith(head));
      });
    });
    expect(unused).toEqual([]);
  });
});
