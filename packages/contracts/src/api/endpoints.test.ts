import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../errors';
import { API_ERROR_REASONS } from './common';
import { API_ENDPOINTS, type ApiEndpointId } from './endpoints';
import { API_FIXTURES } from './fixtures';
import { MOBILE_AUTH_REASONS } from './mobile-auth';

const here = dirname(fileURLToPath(import.meta.url));
const apiDoc = readFileSync(join(here, '../../../../docs/API.md'), 'utf8');

/** `METHOD /path` for every route row in docs/API.md §3.1 to §3.5 and §3.7. */
function documentedRoutes(): string[] {
  const routes: string[] = [];
  let section = '';
  for (const line of apiDoc.split(/\r?\n/)) {
    const heading = /^### (3\.\d)/.exec(line);
    if (heading?.[1] !== undefined) section = heading[1];
    if (!['3.1', '3.2', '3.3', '3.4', '3.5', '3.7'].includes(section)) continue;
    const row = /^\| (GET|POST|GET\/POST) \| `([^`]+)`/.exec(line);
    if (row?.[1] === undefined || row[2] === undefined) continue;
    const path = row[2].split('?')[0] ?? row[2];
    for (const method of row[1].split('/')) routes.push(`${method} ${path}`);
  }
  return routes.sort();
}

const entries = Object.entries(API_ENDPOINTS) as [
  ApiEndpointId,
  (typeof API_ENDPOINTS)[ApiEndpointId],
][];

describe('the /api/v1 endpoint catalogue', () => {
  it('lists exactly the routes docs/API.md documents', () => {
    const catalogued = entries
      .filter(([, e]) => !e.path.startsWith('/workers/'))
      .map(([, e]) => `${e.method} ${e.path}`)
      .sort();
    expect(catalogued).toEqual(documentedRoutes());
  });

  it('documents only error codes and reasons the contracts define', () => {
    const known = new Set<string>([...ERROR_CODES, ...API_ERROR_REASONS, ...MOBILE_AUTH_REASONS]);
    const named = apiDoc
      .split(/\r?\n/)
      .filter((line) =>
        /^\| (GET|POST) \| `\/(auth|sync|files|attendance|expenses|ingest|connector|me|realtime|voice|admin)/.test(
          line,
        ),
      )
      .flatMap((line) => [...(line.split(' | ').at(-1) ?? '').matchAll(/`([a-z_]+)`/g)])
      .map((m) => m[1] ?? '');
    expect(named.length).toBeGreaterThan(30);
    expect(named.filter((word) => !known.has(word))).toEqual([]);
  });

  it('names every worker route of the catalogue in §3.6', () => {
    const workers = apiDoc.slice(apiDoc.indexOf('### 3.6'), apiDoc.indexOf('### 3.7'));
    const documented = new Set(
      [...workers.matchAll(/^\| POST \| `([^`]+)`/gm)].map((m) => m[1] ?? ''),
    );
    const catalogued = entries.filter(([, e]) => e.path.startsWith('/workers/'));
    expect(catalogued.length).toBeGreaterThan(9);
    for (const [, e] of catalogued) expect(documented).toContain(e.path);
  });

  it('names each route once', () => {
    const keys = entries.map(([, e]) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lists every error code docs/API.md §3 names for a route', () => {
    const errorCodes = new Set<string>(ERROR_CODES);
    const byRoute = new Map(entries.map(([id, e]) => [`${e.method} ${e.path}`, id]));
    const missing: string[] = [];
    let checked = 0;
    let inSection3 = false;
    for (const line of apiDoc.split(/\r?\n/)) {
      if (line.startsWith('## ')) inSection3 = /^## 3\b/.test(line);
      if (!inSection3) continue;
      const row = /^\| (GET|POST|GET\/POST) \| `([^`]+)`/.exec(line);
      if (row?.[1] === undefined || row[2] === undefined) continue;
      const path = row[2].split('?')[0] ?? row[2];
      const named = [...line.matchAll(/`([a-z_]+)`/g)]
        .map((m) => m[1] ?? '')
        .filter((word) => errorCodes.has(word));
      // A GET/POST row names the codes of both routes together (a webhook's handshake and its
      // deliveries), so either route may list each one.
      const ids = row[1].split('/').flatMap((method) => byRoute.get(`${method} ${path}`) ?? []);
      if (ids.length === 0) continue;
      checked += ids.length;
      const listed = new Set<string>(ids.flatMap((id) => API_ENDPOINTS[id].errors));
      for (const code of named) if (!listed.has(code)) missing.push(`${ids.join('/')}: ${code}`);
    }
    expect(checked).toBeGreaterThan(30);
    expect(missing).toEqual([]);
  });

  it('answers only with codes from the error catalogue', () => {
    for (const [, e] of entries) {
      for (const code of e.errors) expect(ERROR_CODES).toContain(code);
    }
  });

  it('asks the field app and the connector for an idempotency key on their mutating calls', () => {
    const keyed = entries.filter(([, e]) => e.idempotencyKey).map(([id]) => id);
    expect(keyed.sort()).toEqual(
      [
        'attendance.checkIn',
        'connector.batches',
        'connector.snapshot',
        'expenses.create',
        'files.complete',
        'files.presign',
        'sync.push',
      ].sort(),
    );
  });
});

describe('every route parses its recorded example', () => {
  for (const [id, endpoint] of entries) {
    it(id, () => {
      const fixture = API_FIXTURES[id];
      const e: {
        params?: { parse: (v: unknown) => unknown };
        query?: { parse: (v: unknown) => unknown };
        request?: { parse: (v: unknown) => unknown };
        response: { parse: (v: unknown) => unknown } | 'text';
      } = endpoint;
      if (e.params !== undefined) expect(() => e.params?.parse(fixture.params)).not.toThrow();
      if (e.query !== undefined) expect(() => e.query?.parse(fixture.query)).not.toThrow();
      if (e.request !== undefined) {
        expect(fixture.request, 'a request example').toBeDefined();
        e.request.parse(fixture.request);
      }
      if (e.response !== 'text') {
        expect(fixture.response, 'a response example').toBeDefined();
        e.response.parse(fixture.response);
      }
    });
  }
});
