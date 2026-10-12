import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  checkBudgets,
  checkDocument,
  documentBytes,
  formatTable,
  measureRoutes,
  pageRoutes,
  parseBudgets,
  parseRouteStats,
} from './js-budget';

/** A small build: two root chunks every page loads, and one chunk of each page's own. */
const CHUNKS: Record<string, Uint8Array> = {
  '.next/static/chunks/root-a.js': new TextEncoder().encode('a'.repeat(4000)),
  '.next/static/chunks/root-b.js': new TextEncoder().encode('function b(){return 1}'.repeat(50)),
  '.next/static/chunks/leads.js': new TextEncoder().encode(
    Array.from({ length: 3000 }, (_, i) => `v${String(i * 7919)}`).join(';'),
  ),
  '.next/static/chunks/sign-in.js': new TextEncoder().encode('const s=1;'.repeat(20)),
};

/** As Next.js writes it on Windows: project-relative paths with backslashes, largest first. */
const STATS = [
  {
    route: '/leads',
    firstLoadUncompressedJsBytes: 0,
    firstLoadChunkPaths: [
      '.next\\static\\chunks\\leads.js',
      '.next\\static\\chunks\\root-a.js',
      '.next\\static\\chunks\\root-b.js',
    ],
  },
  {
    route: '/sign-in',
    firstLoadUncompressedJsBytes: 0,
    firstLoadChunkPaths: [
      '.next/static/chunks/sign-in.js',
      '.next/static/chunks/root-a.js',
      '.next/static/chunks/root-b.js',
    ],
  },
];

const ROUTES_MANIFEST = {
  '/(bos)/leads/page': '/leads',
  '/(public)/sign-in/page': '/sign-in',
  '/_global-error/page': '/_global-error',
  '/api/v1/health/route': '/api/v1/health',
};

function gz(...paths: string[]): number {
  return paths.reduce((sum, p) => sum + gzipSync(CHUNKS[p] ?? new Uint8Array()).byteLength, 0);
}

function readChunk(reads: string[]) {
  return (path: string): Uint8Array => {
    reads.push(path);
    const bytes = CHUNKS[path];
    if (bytes === undefined) throw new Error(`no chunk ${path}`);
    return bytes;
  };
}

describe('parseRouteStats', () => {
  it('reads each route with its chunks, as forward-slash paths', () => {
    expect(parseRouteStats(STATS)).toEqual([
      {
        route: '/leads',
        chunks: [
          '.next/static/chunks/leads.js',
          '.next/static/chunks/root-a.js',
          '.next/static/chunks/root-b.js',
        ],
      },
      {
        route: '/sign-in',
        chunks: [
          '.next/static/chunks/sign-in.js',
          '.next/static/chunks/root-a.js',
          '.next/static/chunks/root-b.js',
        ],
      },
    ]);
  });

  it('refuses another shape, and a path outside the static chunks', () => {
    expect(() => parseRouteStats({})).toThrow('not a list');
    expect(() => parseRouteStats([])).toThrow('not a list');
    expect(() => parseRouteStats([{ route: '/x', chunks: [] }])).toThrow('firstLoadChunkPaths');
    expect(() =>
      parseRouteStats([{ route: '/x', firstLoadChunkPaths: ['.next/server/app/page.js'] }]),
    ).toThrow('unexpected chunk path');
    expect(() =>
      parseRouteStats([{ route: '/x', firstLoadChunkPaths: ['.next/static/../../secret.js'] }]),
    ).toThrow('unexpected chunk path');
  });
});

describe('parseBudgets', () => {
  it('reads the page budgets and the document budgets', () => {
    expect(
      parseBudgets({
        description: 'ignored',
        routes: { '/leads': { maxKb: 380, reason: 'the staff shell' } },
        documents: { '/sign-in': { maxKb: 30, reason: 'public' } },
      }),
    ).toEqual({
      routes: { '/leads': { maxKb: 380, reason: 'the staff shell' } },
      documents: { '/sign-in': { maxKb: 30, reason: 'public' } },
    });
  });

  it('refuses a default, a budget without a reason and a route without a slash', () => {
    expect(() => parseBudgets({ defaultKb: 250, routes: {} })).toThrow('no default');
    expect(() => parseBudgets({ routes: { '/leads': { maxKb: 300 } } })).toThrow('/leads needs');
    expect(() => parseBudgets({ routes: { '/leads': { maxKb: 300, reason: ' ' } } })).toThrow(
      '/leads needs',
    );
    expect(() => parseBudgets({ routes: { leads: { maxKb: 300, reason: 'x' } } })).toThrow(
      'leads needs',
    );
    expect(() => parseBudgets({ documents: { '/x': { maxKb: 0, reason: 'x' } } })).toThrow(
      '/x needs',
    );
  });
});

describe('pageRoutes', () => {
  it('keeps the pages, leaves out route handlers and the global error page', () => {
    expect(pageRoutes(ROUTES_MANIFEST)).toEqual(['/leads', '/sign-in']);
  });
});

describe('measureRoutes', () => {
  it('adds the gzip size of every chunk of a first load, reading a shared chunk once', () => {
    const reads: string[] = [];
    const sizes = measureRoutes(parseRouteStats(STATS), readChunk(reads));
    const leads = gz(
      '.next/static/chunks/leads.js',
      '.next/static/chunks/root-a.js',
      '.next/static/chunks/root-b.js',
    );
    expect(sizes).toEqual([
      {
        route: '/leads',
        chunks: 3,
        rawBytes: (CHUNKS['.next/static/chunks/leads.js']?.byteLength ?? 0) + 4000 + 22 * 50,
        gzipBytes: leads,
      },
      {
        route: '/sign-in',
        chunks: 3,
        rawBytes: 200 + 4000 + 22 * 50,
        gzipBytes: gz(
          '.next/static/chunks/sign-in.js',
          '.next/static/chunks/root-a.js',
          '.next/static/chunks/root-b.js',
        ),
      },
    ]);
    expect(reads).toHaveLength(4);
    expect(leads).toBeLessThan(sizes[0]?.rawBytes ?? 0);
  });

  it('fails when a chunk the statistics name is missing', () => {
    expect(() =>
      measureRoutes([{ route: '/x', chunks: ['.next/static/chunks/gone.js'] }], readChunk([])),
    ).toThrow('no chunk');
  });
});

describe('checkBudgets', () => {
  const sizes = measureRoutes(parseRouteStats(STATS), readChunk([]));
  const leadsBytes = sizes[0]?.gzipBytes ?? 0;
  const pages = pageRoutes(ROUTES_MANIFEST);
  const both = {
    '/leads': { maxKb: 250, reason: 'staff' },
    '/sign-in': { maxKb: 10, reason: 'public' },
  };

  it('passes routes within their budgets', () => {
    const report = checkBudgets(sizes, { routes: both, documents: {} }, pages);
    expect(report.problems).toEqual([]);
    expect(report.rows.map((r) => [r.route, r.budgetKb, r.over])).toEqual([
      ['/leads', 250, false],
      ['/sign-in', 10, false],
    ]);
  });

  it('fails a page with no budget of its own (ARCH-6)', () => {
    const report = checkBudgets(
      sizes,
      { routes: { '/sign-in': { maxKb: 10, reason: 'public' } }, documents: {} },
      pages,
    );
    expect(report.problems).toEqual([
      expect.stringMatching(/^\/leads loads [\d.]+ kB of JavaScript \(gzip\) and has no budget/),
    ]);
  });

  it('fails a route one byte over its budget, and passes it at the budget exactly', () => {
    const at = checkBudgets(
      sizes,
      {
        routes: { ...both, '/leads': { maxKb: leadsBytes / 1000, reason: 'exact' } },
        documents: {},
      },
      pages,
    );
    expect(at.problems).toEqual([]);
    const over = checkBudgets(
      sizes,
      {
        routes: { ...both, '/leads': { maxKb: (leadsBytes - 1) / 1000, reason: 'one byte less' } },
        documents: {},
      },
      pages,
    );
    expect(over.problems).toEqual([
      expect.stringMatching(/^\/leads loads [\d.]+ kB of JavaScript \(gzip\), over its budget/),
    ]);
    expect(over.rows[0]?.over).toBe(true);
  });

  it('fails a page with no measurement and a budget for a route the build lacks', () => {
    const report = checkBudgets(
      sizes.filter((s) => s.route === '/leads'),
      {
        routes: { ...both, '/old-screen': { maxKb: 300, reason: 'removed' } },
        documents: { '/gone': { maxKb: 30, reason: 'removed' } },
      },
      pages,
    );
    expect(report.problems).toEqual([
      '/sign-in is a page of the build with no measurement',
      'js-budget.json names /old-screen, which the build does not have',
      'js-budget.json names /gone, which the build does not have',
    ]);
  });

  it('prints a table with the budget and the verdict of each page', () => {
    const report = checkBudgets(
      sizes,
      { routes: { '/leads': { maxKb: 0.1, reason: 'tiny' } }, documents: {} },
      pages,
    );
    const table = formatTable(report.rows).split('\n');
    expect(table[0]).toMatch(/^Route\s+Chunks\s+Raw kB\s+Gzip kB\s+Budget kB$/);
    expect(table[1]).toMatch(/^\/leads\s+3\s+[\d.]+\s+[\d.]+\s+0\.1\s+OVER$/);
    expect(table[2]).toMatch(/^\/sign-in\s+3\s+[\d.]+\s+[\d.]+\s+none\s+NO BUDGET$/);
    expect(table).toHaveLength(3);
  });
});

describe('checkDocument (WEB-1)', () => {
  const html = '<html><body>' + 'x'.repeat(5000) + '</body></html>';
  const budgets = { routes: {}, documents: { '/sign-in': { maxKb: 1, reason: 'public' } } };

  it('passes a first visit within its document budget and fails one over it', () => {
    expect(checkDocument('/sign-in', html, budgets)).toBeUndefined();
    expect(documentBytes(html)).toBeLessThan(1000);
    const heavy = Array.from({ length: 4000 }, (_, i) => String(i * 7919)).join(',');
    expect(checkDocument('/sign-in', heavy, budgets)).toMatch(
      /^\/sign-in sends [\d.]+ kB of HTML \(gzip\), over its document budget of 1 kB$/,
    );
  });

  it('fails a page with no document budget', () => {
    expect(checkDocument('/leads', html, budgets)).toBe(
      '/leads has no document budget in js-budget.json',
    );
  });
});
