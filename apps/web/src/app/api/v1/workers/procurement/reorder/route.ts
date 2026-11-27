import { ReorderWorkerBody } from '@shakti/contracts';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import { REORDER_RUN_BUDGET_MS, runReorder } from '../../../../../../workers/procurement-reorder';
import { PROCUREMENT_REORDER_PATH } from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new companies well before this (`REORDER_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * U2: the daily reorder check (docs/03-roadmap-appendix/phase3.md §7.2, docs/06-api.md §3.6). Only
 * QStash calls it, on the schedule `procurement-reorder-<environment>` each morning; the signature,
 * the body and the answers are `nightlyWorkerRoute`'s.
 */
export const POST = nightlyWorkerRoute({
  path: PROCUREMENT_REORDER_PATH,
  job: 'procurement-reorder',
  logPrefix: 'procurement.reorder',
  body: ReorderWorkerBody,
  budgetMs: REORDER_RUN_BUDGET_MS,
  run: (_body, options) => runReorder(options),
});
