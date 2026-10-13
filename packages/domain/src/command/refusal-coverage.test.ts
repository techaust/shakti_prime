import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commands } from './registry';

// Every command of the registry has a denied case and a wrong-company case in the suites on real
// Postgres (AGENTS.md §5 and §10, audit OPS-6). Read from the test files' text: a test case (an
// `it` or `test`, or a whole `describe.each`/`it.each` table with its cases) that names the command
// by its export or its name, directly or through a helper or constant of its file, and expects
// `'forbidden'` is a denied case; one that names a company outside the request or of another
// aggregate is a wrong-company case. The agent refusal sweep is left out: it covers agents only.
// A command without both is listed in REVIEWED with where its cases are instead, or why the case
// does not apply; an entry no longer needed fails too, so the list never outlives its reason.

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const SUITES = ['packages/domain/tests', 'packages/db/tests', 'apps/web/tests'];

const REVIEWED: Record<string, string> = {
  'notifications.notice.read':
    "A person's own notices, by id: the input names no company, every person's role holds profile.write:own, and notifications.test.ts refuses another person's notices.",
  'notifications.preferences.set':
    "A person's own notification settings: the input names no company and every person's role holds profile.write:own.",
  'notifications.push.subscribe':
    "A person's own browser: the input names no company and every person's role holds profile.write:own.",
  'notifications.push.unsubscribe':
    "A person's own browser: the input names no company and every person's role holds profile.write:own.",
  'profile.contrast.set':
    "A person's own display setting: the input names no company and every person's role holds profile.write:own.",
  'profile.theme.set':
    "A person's own display setting: the input names no company and every person's role holds profile.write:own.",
  'profile.view.delete':
    "A person's own saved view: the input names no company, every person's role holds profile.write:own, and saved-views tests refuse another person's view.",
  'profile.view.save':
    "A person's own saved view: the input names no company and every person's role holds profile.write:own.",
};

const DENIED = "'forbidden'";
const OTHER_COMPANY =
  /entityIds?: \[?\s*(2|E2|OTHER|ENTITY_2|CO2)\b|\[1, 2\]|\[2\]|\b(another|other|wrong) company|outside the request|company 2|\belsewhere\b|\(2\)|, 2\)|config_group_scope|catalogue_needs_all_companies/;

/** The index after the string literal that starts at `i`, template substitutions included. */
function skipString(s: string, start: number): number {
  const quote = s[start];
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && c === '$' && s[i + 1] === '{') {
      i = closing(s, i + 1) + 1;
      continue;
    }
    if (c === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** The index of the bracket that closes the one at `start`, skipping strings and comments. */
function closing(s: string, start: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack = [pairs[s[start] ?? ''] ?? ''];
  let i = start + 1;
  while (i < s.length && stack.length > 0) {
    const c = s[i] ?? '';
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(s, i);
      continue;
    }
    if (s.startsWith('//', i)) {
      const end = s.indexOf('\n', i);
      i = end < 0 ? s.length : end;
      continue;
    }
    if (s.startsWith('/*', i)) {
      i = s.indexOf('*/', i) + 2;
      continue;
    }
    const open = pairs[c];
    if (open !== undefined) stack.push(open);
    else if (c === stack.at(-1)) stack.pop();
    i += 1;
  }
  return i - 1;
}

/** The test cases of a file: each `.each` table with its cases, and every other `it` or `test`. */
function testCases(s: string): string[] {
  const cases: string[] = [];
  const tables: [number, number][] = [];
  for (const m of s.matchAll(/\b(describe|it|test)\.each\b/g)) {
    let end = closing(s, s.indexOf('(', m.index));
    if (s[end + 1] === '(') end = closing(s, end + 1);
    tables.push([m.index, end]);
    cases.push(s.slice(m.index, end + 1));
  }
  for (const m of s.matchAll(
    /(?<![\w.])(it|test)(\.(only|skip|skipIf\([^)]*\)|runIf\([^)]*\)))?\(/g,
  )) {
    if (tables.some(([a, b]) => a <= m.index && m.index <= b)) continue;
    const end = closing(s, m.index + m[0].length - 1);
    cases.push(s.slice(m.index, end + 1));
  }
  return cases;
}

/** The constants and functions a file declares, by name, each with its text. */
function declarations(s: string): Map<string, string[]> {
  const lines = s.split('\n');
  const found = new Map<string, string[]>();
  const indent = (line: string) => line.length - line.trimStart().length;
  lines.forEach((line, i) => {
    const m = /^(\s*)(?:export\s+)?(?:const|let|(?:async\s+)?function)\s+(\w+)/.exec(line);
    if (m === null) return;
    const depth = m[1]?.length ?? 0;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? '';
      const inside =
        next.trim() === '' ||
        indent(next) > depth ||
        (indent(next) === depth && /^[})\]]/.test(next.trim()));
      if (!inside) break;
      j += 1;
    }
    const name = m[2] ?? '';
    found.set(name, [...(found.get(name) ?? []), lines.slice(i, j).join('\n')]);
  });
  return found;
}

/** A test case with the declarations it names, and theirs, two levels deep. */
function expanded(text: string, declared: Map<string, string[]>): string {
  const seen = new Set<string>();
  let frontier = [text];
  const parts = [text];
  for (let level = 0; level < 2; level += 1) {
    const next: string[] = [];
    for (const part of frontier) {
      for (const [, name] of part.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
        if (name === undefined || seen.has(name)) continue;
        const bodies = declared.get(name);
        if (bodies === undefined) continue;
        seen.add(name);
        next.push(...bodies);
      }
    }
    parts.push(...next);
    frontier = next;
  }
  return parts.join('\n');
}

function filesUnder(folder: string, pattern: RegExp): string[] {
  return readdirSync(`${root}${folder}`, { recursive: true, encoding: 'utf8' })
    .filter((path) => pattern.test(path))
    .map((path) => `${folder}/${path.replaceAll('\\', '/')}`);
}

/** Each command's name with the name it is exported under. */
function exportsByName(): Map<string, string> {
  const found = new Map<string, string>();
  for (const path of filesUnder('packages/domain/src/commands', /(?<!\.test)\.ts$/)) {
    const text = readFileSync(`${root}${path}`, 'utf8');
    for (const m of text.matchAll(/export const (\w+) = defineCommand\(\{\s*name: '([^']+)'/g)) {
      if (m[1] !== undefined && m[2] !== undefined) found.set(m[2], m[1]);
    }
  }
  return found;
}

function uncovered(): Map<string, { denied: boolean; otherCompany: boolean }> {
  const cases = SUITES.flatMap((suite) => filesUnder(suite, /\.test\.ts$/))
    .filter((path) => !path.endsWith('agent-refusals.test.ts'))
    .flatMap((path) => {
      const text = readFileSync(`${root}${path}`, 'utf8');
      const declared = declarations(text);
      return testCases(text).map((c) => expanded(c, declared));
    });
  const exported = exportsByName();
  const missing = new Map<string, { denied: boolean; otherCompany: boolean }>();
  for (const name of Object.keys(commands)) {
    const ident = exported.get(name) ?? name;
    const names = new RegExp(`\\b${ident}\\b|'${name.replaceAll('.', '\\.')}'`);
    const mine = cases.filter((c) => names.test(c));
    const denied = mine.some((c) => c.includes(DENIED));
    const otherCompany = mine.some((c) => OTHER_COMPANY.test(c));
    if (!denied || !otherCompany) missing.set(name, { denied, otherCompany });
  }
  return missing;
}

describe('the refusal cases of every command (audit OPS-6)', { timeout: 60_000 }, () => {
  it('finds every command of the registry exported under its own name', () => {
    const exported = exportsByName();
    expect([...exported.keys()].sort()).toEqual(Object.keys(commands).sort());
  });

  it('finds a denied and a wrong-company case for every command not reviewed', () => {
    const missing = uncovered();
    const unreviewed = [...missing].filter(([name]) => REVIEWED[name] === undefined);
    expect(unreviewed).toEqual([]);
  });

  it('keeps a reviewed command only while it still needs its reason', () => {
    const missing = uncovered();
    expect(Object.keys(REVIEWED).filter((name) => !missing.has(name))).toEqual([]);
    for (const name of Object.keys(REVIEWED)) expect(Object.keys(commands)).toContain(name);
  });
});
