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
    if (path.startsWith('/admin/')) continue;
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
        /^\| (GET|POST) \| `\/(auth|sync|files|attendance|expenses|ingest|connector|me|realtime|voice)/.test(
          line,
        ),
      )
      .flatMap((line) => [...(line.split(' | ').at(-1) ?? '').matchAll(/`([a-z_]+)`/g)])
      .map((m) => m[1] ?? '');
    expect(named.length).toBeGreaterThan(30);
    expect(named.filter((word) => !known.has(word))).toEqual([]);
  });

  it('names each route once', () => {
    const keys = entries.map(([, e]) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
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
