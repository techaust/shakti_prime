import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

/**
 * The top-level arguments of the call whose `(` is at `open`: the text between the parentheses,
 * split at the commas outside brackets, strings and comments.
 */
function callArguments(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = open + 1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== undefined) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
    } else if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) {
        args.push(text.slice(start, i));
        return args.map((a) => a.trim()).filter((a) => a !== '');
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  throw new Error('a call is not closed');
}

/** Every `executeQuery(…)` call in the web app, with the file and line it is on. */
const calls = filesUnder(here).flatMap((path) => {
  const text = readFileSync(path, 'utf8');
  const file = relative(here, path).replaceAll('\\', '/');
  return [...text.matchAll(/(?<![\w.])executeQuery\(/g)].map((match) => {
    const open = match.index + match[0].length - 1;
    return {
      where: `${file}:${String(text.slice(0, open).split('\n').length)}`,
      args: callArguments(text, open),
    };
  });
});

describe('query timing lines', () => {
  it('finds the reads the web app makes', () => {
    expect(calls.length).toBeGreaterThan(0);
  });

  it("names every executeQuery call, so its timing line never reads 'anonymous'", () => {
    // The fourth argument is the options, with the name as a string: `{ name: 'listLeads' }`.
    const unnamed = calls
      .filter(({ args }) => !/^\{[^}]*\bname:\s*(['"])[^'"\s]+\1/.test(args[3] ?? ''))
      .map(({ where }) => where);
    expect(unnamed).toEqual([]);
  });
});
