// Fails when a page's first-load JavaScript is over its budget in js-budget.json (BLUEPRINT
// §11.4). Run after the production build: `pnpm build`, then `pnpm --filter web js-budget`.
// CI runs it in the build job. How the sizes are measured is in js-budget.ts.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkBudgets,
  formatTable,
  measureRoutes,
  pageRoutes,
  parseBudgets,
  parseRouteStats,
} from './js-budget';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const statsFile = join(appDir, '.next', 'diagnostics', 'route-bundle-stats.json');
const routesFile = join(appDir, '.next', 'app-path-routes-manifest.json');
const budgetFile = join(appDir, 'js-budget.json');

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

if (!existsSync(statsFile)) {
  console.error(
    `${statsFile} is missing: run the production build first (pnpm build). Next.js writes it for Turbopack builds; if a Next.js upgrade stopped writing it, js-budget.ts needs another source.`,
  );
  process.exit(1);
}

const stats = parseRouteStats(readJson(statsFile));
const sizes = measureRoutes(stats, (path) => readFileSync(join(appDir, path)));
const report = checkBudgets(
  sizes,
  parseBudgets(readJson(budgetFile)),
  pageRoutes(readJson(routesFile)),
);

console.log('First-load JavaScript per page (gzip, kB of 1,000 bytes)\n');
console.log(formatTable(report.rows));
if (report.problems.length > 0) {
  console.error(`\n${report.problems.map((p) => `- ${p}`).join('\n')}`);
  console.error(
    '\nShrink the page, or change its budget in apps/web/js-budget.json with the reason.',
  );
  process.exit(1);
}
console.log(`\nEvery page is within its budget (${String(report.rows.length)} pages).`);
