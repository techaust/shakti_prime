import { jsonLogger, type Logger } from '../ports/logger';

/**
 * How long one batch may take, from the moment the command begins (a wait for the job's row
 * included), so a batch the worker starts at the end of its run (`IMPORT_RUN_BUDGET_MS`,
 * apps/web/src/workers/imports.ts) still ends inside the route's 60 seconds.
 */
export const IMPORT_BATCH_BUDGET_MS = 20_000;

/**
 * The longest a set-based try of a batch of 500 is taken to need: the slowest batch measured
 * (docs/spikes/import-scale.md, 17.2 seconds). A batch with less of its budget left than this
 * goes straight to the row-by-row path, which looks at the time between rows.
 */
export const SET_BASED_BATCH_BOUND_MS = 17_200;

/**
 * How a batch keeps to the import worker's time. The set-based path has no point at which it can
 * stop, so it is tried only while at least `SET_BASED_BATCH_BOUND_MS` of the batch's `budgetMs`
 * is left. The row-by-row path runs `crm.lead.create` once a row and looks at the time between
 * rows; once `budgetMs` has passed since the batch began it stops, keeps the rows done so far as
 * this batch and leaves the rest for the next one. At least one row is always done, so every
 * batch moves the job on. `logger` records why a batch went row by row. Changed, these change
 * every request the process serves, so only `commit-job.ts` reads them and only tests change
 * them, through `@shakti/domain/testing` (both fenced by ESLint).
 */
export const importBatchSettings: { budgetMs: number; now: () => number; logger: Logger } = {
  budgetMs: IMPORT_BATCH_BUDGET_MS,
  now: () => performance.now(),
  logger: jsonLogger(),
};
