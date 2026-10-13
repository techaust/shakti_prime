import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTH_FORM_ERRORS, PUBLIC_ERROR_KEYS } from '../auth/public-errors';
import { REASONS } from '../auth/errors';
import { CLIENT_SCOPES, type ClientScope } from './client-namespaces';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(src, 'app');
const bos = join(app, '(bos)');

function resolveImport(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  return [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')].find(
    (path) => existsSync(path) && statSync(path).isFile(),
  );
}

/**
 * The namespaces the client components reachable from `entries` translate: every file a
 * `'use client'` file imports runs in the browser too, so its `useTranslations` counts; a server
 * component's does not.
 */
function clientNamespaces(entries: readonly string[]): Set<string> {
  const used = new Set<string>();
  const seen = new Map<string, boolean>();
  const visit = (file: string, client: boolean) => {
    const before = seen.get(file);
    if (before === true || (before === false && !client)) return;
    seen.set(file, client);
    const text = readFileSync(file, 'utf8');
    const inBrowser = client || /^\s*['"]use client['"]/.test(text);
    if (inBrowser) {
      for (const m of text.matchAll(/useTranslations\(\s*[`'"]([a-zA-Z]+)/g)) {
        if (m[1] !== undefined) used.add(m[1]);
      }
    }
    const specs = [
      ...[...text.matchAll(/(?:import|export)\s(?!type\s)[^;]*?from\s+'(\.[^']+)'/g)].map(
        (m) => m[1],
      ),
      ...[...text.matchAll(/import\(\s*'(\.[^']+)'\s*\)/g)].map((m) => m[1]),
    ];
    for (const spec of specs) {
      const target = spec === undefined ? undefined : resolveImport(file, spec);
      if (target !== undefined) visit(target, inBrowser);
    }
  };
  for (const entry of entries) visit(entry, false);
  return used;
}

/** A folder's route files: its pages, layouts and error, loading and not-found screens. */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /^(page|layout|error|loading|not-found|template|default)\.tsx$/.test(name) ? [path] : [];
  });
}

const segments = readdirSync(bos).filter((name) => statSync(join(bos, name)).isDirectory());

/** What each scope's client code reaches, and the scopes whose messages it already has. */
const SCOPES: { scope: ClientScope; entries: string[]; inherits: ClientScope[] }[] = [
  {
    scope: 'root',
    entries: ['layout.tsx', 'error.tsx', 'not-found.tsx', 'global-error.tsx'].map((f) =>
      join(app, f),
    ),
    inherits: [],
  },
  { scope: 'public', entries: routeFiles(join(app, '(public)')), inherits: ['root'] },
  { scope: 'bos', entries: [join(bos, 'layout.tsx'), join(bos, 'error.tsx')], inherits: ['root'] },
  ...segments.map((name) => ({
    scope: `/${name}` as ClientScope,
    entries: routeFiles(join(bos, name)),
    inherits: ['root', 'bos'] as ClientScope[],
  })),
];

describe('messages sent to the browser, by part of the app (AUDIT L12, WEB-1)', () => {
  it('name a scope for every folder of the (bos) route group', () => {
    const scopes: readonly string[] = Object.keys(CLIENT_SCOPES);
    expect(segments.map((s) => `/${s}`).filter((s) => !scopes.includes(s))).toEqual([]);
  });

  it.each(SCOPES)(
    '$scope sends every namespace its client components translate, only those, and none twice',
    ({ scope, entries, inherits }) => {
      const used = clientNamespaces(entries);
      const own: readonly string[] = CLIENT_SCOPES[scope];
      const above = new Set<string>(inherits.flatMap((s) => CLIENT_SCOPES[s]));
      expect([...used].filter((ns) => !own.includes(ns) && !above.has(ns)).sort()).toEqual([]);
      expect(own.filter((ns) => !used.has(ns))).toEqual([]);
      expect(own.filter((ns) => above.has(ns))).toEqual([]);
    },
  );

  it('gives each route folder the provider of its own scope', () => {
    const provides = (file: string, scope: string) =>
      readFileSync(file, 'utf8').includes(`<ClientMessages scope="${scope}">`);
    expect(provides(join(app, 'layout.tsx'), 'root')).toBe(true);
    expect(provides(join(app, '(public)', 'layout.tsx'), 'public')).toBe(true);
    expect(provides(join(bos, 'layout.tsx'), 'bos')).toBe(true);
    for (const name of segments) {
      expect({ name, ok: provides(join(bos, name, 'layout.tsx'), `/${name}`) }).toEqual({
        name,
        ok: true,
      });
    }
  });
});

describe('the error sentences of the public pages', () => {
  it('hold every reason a sign-in, password or code failure maps to', () => {
    const reasons = Object.values(REASONS).map((r) => r.reason);
    expect(reasons.filter((r) => !PUBLIC_ERROR_KEYS.includes(r))).toEqual([]);
  });

  it("hold every sentence the public forms set themselves, and nothing of the staff screens'", () => {
    const actions = readFileSync(join(src, 'actions', 'auth.ts'), 'utf8');
    const literals = [...actions.matchAll(/error: '([a-z_]+)'/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    expect(literals.filter((key) => !PUBLIC_ERROR_KEYS.includes(key))).toEqual([]);
    expect(AUTH_FORM_ERRORS.every((key) => literals.includes(key))).toBe(true);
    expect(PUBLIC_ERROR_KEYS).not.toContain('quote_expired');
    expect(PUBLIC_ERROR_KEYS.length).toBeLessThan(60);
  });
});
