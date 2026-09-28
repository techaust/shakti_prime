// The per-route JavaScript budget (BLUEPRINT §11.4: a JS budget per route for low-end Android
// phones on 3G/4G). Pure parts only, so they can be tested on a small fixture; the command-line
// check that reads the build is `check-js-budget.ts`.
//
// What a first visit downloads comes from the build itself: with Turbopack, `next build` writes
// `.next/diagnostics/route-bundle-stats.json`, one row per page with the client chunks of its
// first load (the framework's root chunks plus every chunk of the route's layouts and page).
// The legacy-browser polyfill is loaded only by browsers without modules, so it is left out,
// as Next.js leaves it out. Sizes are gzip at zlib's default level, in kB of 1,000 bytes.
import { gzipSync } from 'node:zlib';

export interface RouteStat {
  route: string;
  /** Chunk paths relative to the app folder, with forward slashes (`.next/static/chunks/…`). */
  chunks: string[];
}

export interface RouteBudget {
  maxKb: number;
  reason: string;
}

export interface Budgets {
  /** The budget of every route the file does not name. */
  defaultKb: number;
  routes: Record<string, RouteBudget>;
}

export interface RouteSize {
  route: string;
  chunks: number;
  rawBytes: number;
  gzipBytes: number;
}

export interface BudgetRow extends RouteSize {
  budgetKb: number;
  named: boolean;
  over: boolean;
}

export interface BudgetReport {
  rows: BudgetRow[];
  problems: string[];
}

/** Routes Next.js leaves out of its own statistics: the page shown when the root layout fails. */
const UNMEASURED_PAGES = new Set(['/_global-error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only files the browser downloads from the build's static folder are counted. */
function normaliseChunk(path: string): string {
  const posix = path.replaceAll('\\', '/');
  if (!/^\.next\/static\/[\w./-]+\.js$/.test(posix) || posix.split('/').includes('..')) {
    throw new Error(`unexpected chunk path in route-bundle-stats.json: ${path}`);
  }
  return posix;
}

/** Reads `route-bundle-stats.json`; any other shape fails, so a Next.js change is noticed. */
export function parseRouteStats(json: unknown): RouteStat[] {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('route-bundle-stats.json is not a list of routes');
  }
  return json.map((row: unknown) => {
    if (
      !isRecord(row) ||
      typeof row.route !== 'string' ||
      !Array.isArray(row.firstLoadChunkPaths) ||
      !row.firstLoadChunkPaths.every((p) => typeof p === 'string')
    ) {
      throw new Error('route-bundle-stats.json has a row without route and firstLoadChunkPaths');
    }
    return {
      route: row.route,
      chunks: [...new Set(row.firstLoadChunkPaths.map(normaliseChunk))],
    };
  });
}

/** Reads `js-budget.json`: a positive default and, per named route, a budget with its reason. */
export function parseBudgets(json: unknown): Budgets {
  if (!isRecord(json) || typeof json.defaultKb !== 'number' || !(json.defaultKb > 0)) {
    throw new Error('js-budget.json needs a positive defaultKb');
  }
  const routes: Record<string, RouteBudget> = {};
  const named = json.routes ?? {};
  if (!isRecord(named)) throw new Error('js-budget.json routes must be an object');
  for (const [route, entry] of Object.entries(named)) {
    if (
      !route.startsWith('/') ||
      !isRecord(entry) ||
      typeof entry.maxKb !== 'number' ||
      !(entry.maxKb > 0) ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim() === ''
    ) {
      throw new Error(`js-budget.json: ${route} needs a positive maxKb and a reason`);
    }
    routes[route] = { maxKb: entry.maxKb, reason: entry.reason };
  }
  return { defaultKb: json.defaultKb, routes };
}

/** The page routes of the build, from `app-path-routes-manifest.json` (route handlers left out). */
export function pageRoutes(manifest: unknown): string[] {
  if (!isRecord(manifest)) throw new Error('app-path-routes-manifest.json is not an object');
  const routes = Object.entries(manifest)
    .filter(([appPath, route]) => appPath.endsWith('/page') && typeof route === 'string')
    .map(([, route]) => route as string)
    .filter((route) => !UNMEASURED_PAGES.has(route));
  return [...new Set(routes)].sort();
}

/** Raw and gzip size of each route's first load; a chunk shared by routes is read once. */
export function measureRoutes(
  stats: readonly RouteStat[],
  readChunk: (path: string) => Uint8Array,
): RouteSize[] {
  const cache = new Map<string, { raw: number; gzip: number }>();
  const sizeOf = (path: string) => {
    let size = cache.get(path);
    if (size === undefined) {
      const bytes = readChunk(path);
      size = { raw: bytes.byteLength, gzip: gzipSync(bytes).byteLength };
      cache.set(path, size);
    }
    return size;
  };
  return stats.map(({ route, chunks }) => {
    let rawBytes = 0;
    let gzipBytes = 0;
    for (const chunk of chunks) {
      const size = sizeOf(chunk);
      rawBytes += size.raw;
      gzipBytes += size.gzip;
    }
    return { route, chunks: chunks.length, rawBytes, gzipBytes };
  });
}

/**
 * Each measured route against its budget. Also a problem: a page of the build with no
 * measurement (the statistics stopped covering it) and a named budget for a route the build no
 * longer has (a stale entry would hide the next route of that name).
 */
export function checkBudgets(
  sizes: readonly RouteSize[],
  budgets: Budgets,
  builtPages: readonly string[],
): BudgetReport {
  const rows = sizes
    .map((size) => {
      const named = budgets.routes[size.route];
      const budgetKb = named?.maxKb ?? budgets.defaultKb;
      return {
        ...size,
        budgetKb,
        named: named !== undefined,
        over: size.gzipBytes > Math.round(budgetKb * 1000),
      };
    })
    .sort((a, b) => b.gzipBytes - a.gzipBytes || a.route.localeCompare(b.route));
  const problems = rows
    .filter((r) => r.over)
    .map(
      (r) =>
        `${r.route} loads ${kb(r.gzipBytes)} kB of JavaScript (gzip), over its budget of ${String(r.budgetKb)} kB`,
    );
  const measured = new Set(sizes.map((s) => s.route));
  for (const page of builtPages) {
    if (!measured.has(page)) problems.push(`${page} is a page of the build with no measurement`);
  }
  const built = new Set(builtPages);
  for (const route of Object.keys(budgets.routes)) {
    if (!built.has(route))
      problems.push(`js-budget.json names ${route}, which the build does not have`);
  }
  return { rows, problems };
}

export function kb(bytes: number): string {
  return (bytes / 1000).toFixed(1);
}

/** A plain-text table for the CI log. */
export function formatTable(rows: readonly BudgetRow[]): string {
  const header = ['Route', 'Chunks', 'Raw kB', 'Gzip kB', 'Budget kB', ''];
  const lines = rows.map((r) => [
    r.route,
    String(r.chunks),
    kb(r.rawBytes),
    kb(r.gzipBytes),
    `${String(r.budgetKb)}${r.named ? '' : ' (default)'}`,
    r.over ? 'OVER' : 'ok',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => (l[i] ?? '').length)));
  const pad = (cells: string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0)))
      .join('  ')
      .trimEnd();
  return [pad(header), ...lines.map(pad)].join('\n');
}
