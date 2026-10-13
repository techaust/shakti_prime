import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commands } from './registry';

// Every command of the registry has a denied case and a wrong-company case in the suites on real
// Postgres (AGENTS.md §5 and §10, audit OPS-6). Read from the test files' text: a test case (an
// `it` or `test`, or a whole `describe.each`/`it.each` table with its cases) names the command by
// its export or its name, in its own text or in a helper of its file it calls (a table of
// commands, as `opportunity.test.ts` keeps). It is a denied case when its own text expects
// `'forbidden'`, and a wrong-company case when its own text names a company outside the request
// or a request of more than one company. The agent refusal sweep is left out: it covers agents
// only. A command without both is listed in REVIEWED with where its cases are instead, or why the
// case does not apply; an entry no longer needed fails too, so the list never outlives its reason.

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const SUITES = ['packages/domain/tests', 'packages/db/tests', 'apps/web/tests'];

const REVIEWED: Record<string, string> = {
  'catalogue.item.archive':
    'Catalogue data is shared by every company: the company case is a request for one company, refused with `catalogue_needs_all_companies` in catalogue.test.ts "refuses a GM or an Inventory Manager acting for one company, in every command".',
  'catalogue.item.update':
    'Catalogue data is shared by every company: the company case is a request for one company, refused with `catalogue_needs_all_companies` in catalogue.test.ts "refuses a GM or an Inventory Manager acting for one company, in every command".',
  'catalogue.kit.archive':
    'Catalogue data is shared by every company: the company case is a request for one company, refused with `catalogue_needs_all_companies` in catalogue.test.ts "refuses a GM or an Inventory Manager acting for one company, in every command".',
  'catalogue.kit.create':
    'Catalogue data is shared by every company: the company case is a request for one company, refused with `catalogue_needs_all_companies` in catalogue.test.ts "refuses a GM or an Inventory Manager acting for one company, in every command".',
  'catalogue.kit.update':
    'Catalogue data is shared by every company: the company case is a request for one company, refused with `catalogue_needs_all_companies` in catalogue.test.ts "refuses a GM or an Inventory Manager acting for one company, in every command".',
  'catalogue.pump_curve.set':
    'Catalogue data is shared by every company: the company case is a request for one company, refused with `catalogue_needs_all_companies` in catalogue.test.ts "refuses a GM or an Inventory Manager acting for one company, in every command".',
  'crm.commission_rule.set':
    'Commission rules are set for the whole group (`assertConfigScope(ctx, null)`): the company case is an Executive acting for one company, refused with `config_group_scope` in crm-scoring-referrals.test.ts.',
  'files.file.recheck':
    'Sends every waiting file of every company back to its checks: only an Executive acting for every company may (`minScope: \'all\'`), refused otherwise in files.test.ts "is denied to anyone but an Executive acting for every company".',
  'notifications.notice.read':
    "A person's own notices, by id: the input names no company and every person's role holds profile.write:own. notifications.test.ts refuses another person's notices.",
  'notifications.notice.read_all':
    "A person's own notices: the input names no company and every person's role holds profile.write:own. It marks only the caller's own rows, and an agent is refused in notifications.test.ts.",
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
    "A person's own saved view: the input names no company and every person's role holds profile.write:own. saved-views tests refuse another person's view.",
  'profile.view.save':
    "A person's own saved view: the input names no company and every person's role holds profile.write:own.",
  'tax.composite.set':
    'Tax rates are shared by every company: the company case is a request for fewer than every company, refused in tax.test.ts ("is refused to Accounts … acting for fewer than every company" and "… acting for one company").',
  'tax.rate.set':
    'Tax rates are shared by every company: the company case is a request for fewer than every company, refused in tax.test.ts ("is refused to Accounts … acting for fewer than every company" and "… acting for one company").',
};

const DENIED = "'forbidden'";
/** A company outside the request, a request of more than one company, or the words for them. */
const OTHER_COMPANY =
  /entityIds?: \[?\s*(2|E2|OTHER|ENTITY_2|CO2)\b|\[1, 2\]|\b(another|other|wrong) company|outside the request|company 2\b|a company (it|the item|they) (is|are) not in/;

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

/** A test case with the helpers of its file it calls, where a table of commands may live. */
function withCalledHelpers(text: string, declared: Map<string, string[]>): string {
  const called = new Set([...text.matchAll(/\b([A-Za-z_]\w*)\(/g)].map((m) => m[1] ?? ''));
  return [text, ...[...called].flatMap((name) => declared.get(name) ?? [])].join('\n');
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

interface TestCase {
  own: string;
  named: string;
}

function casesOf(text: string): TestCase[] {
  const declared = declarations(text);
  return testCases(text).map((own) => ({ own, named: withCalledHelpers(own, declared) }));
}

/** Whether the cases hold a denied and a wrong-company case for the command. */
function judge(
  cases: readonly TestCase[],
  name: string,
  ident: string,
): { denied: boolean; otherCompany: boolean } {
  const names = new RegExp(`\\b${ident}\\b|'${name.replaceAll('.', '\\.')}'`);
  const mine = cases.filter((c) => names.test(c.named));
  return {
    denied: mine.some((c) => c.own.includes(DENIED)),
    otherCompany: mine.some((c) => OTHER_COMPANY.test(c.own)),
  };
}

function uncovered(): Map<string, { denied: boolean; otherCompany: boolean }> {
  const cases = SUITES.flatMap((suite) => filesUnder(suite, /\.test\.ts$/))
    .filter((path) => !path.endsWith('agent-refusals.test.ts'))
    .flatMap((path) => casesOf(readFileSync(`${root}${path}`, 'utf8')));
  const exported = exportsByName();
  const missing = new Map<string, { denied: boolean; otherCompany: boolean }>();
  for (const name of Object.keys(commands)) {
    const found = judge(cases, name, exported.get(name) ?? name);
    if (!found.denied || !found.otherCompany) missing.set(name, found);
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

  it('counts only a case that refuses the command, and in its own text a company outside', () => {
    const file = [
      "import { reorderStages } from './x';",
      'function table() {',
      '  return [reorderStages];',
      '}',
      "it('refuses a GM', async () => {",
      "  await expect(run(gm, reorderStages, input)).rejects.toMatchObject({ code: 'forbidden' });",
      '});',
      // A refusal of one company on a group pipeline, and a happy path on company 2's: neither is
      // a case for another company.
      "it('is refused for one company on a group pipeline', async () => {",
      "  expect(await refusal(run(execOne, reorderStages, i))).toMatchObject({ details: { reason: 'config_group_scope' } });",
      '  await run(execTwo, reorderStages, inputOf(await testPipeline(2)));',
      '});',
    ].join('\n');
    expect(judge(casesOf(file), 'crm.stage.reorder', 'reorderStages')).toEqual({
      denied: true,
      otherCompany: false,
    });
    const withCase = `${file}\nit("does not reach another company's pipeline", async () => {\n  for (const command of table()) await run(execOne, command, i);\n});\n`;
    expect(judge(casesOf(withCase), 'crm.stage.reorder', 'reorderStages')).toEqual({
      denied: true,
      otherCompany: true,
    });
  });

  it('keeps a reviewed command only while it still needs its reason', () => {
    const missing = uncovered();
    expect(Object.keys(REVIEWED).filter((name) => !missing.has(name))).toEqual([]);
    for (const name of Object.keys(REVIEWED)) expect(Object.keys(commands)).toContain(name);
  });
});
