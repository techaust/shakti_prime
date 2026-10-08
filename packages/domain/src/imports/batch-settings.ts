import { jsonLogger, type Logger } from '../ports/logger';

/**
 * How long one batch may take, from the moment the command begins (a wait for the job's row
 * included), so a batch the worker starts at the end of its run (`IMPORT_RUN_BUDGET_MS`,
 * apps/web/src/workers/imports.ts) still ends inside the route's 60 seconds.
 */
export const IMPORT_BATCH_BUDGET_MS = 20_000;

/**
 * The time kept back for the row-by-row slice: the set-based try must end this long before the
 * batch's budget does, and a batch that goes row by row stops after this long (or at the budget),
 * so it soon hands the rest back to the next batch's set-based try. About 60 rows at the measured
 * 21 rows a second (docs/04-architecture-appendix/import-scale.md).
 */
export const ROW_BY_ROW_SLICE_MS = 3_000;

/** The least time worth a set-based try; with less left before its deadline it is not made. */
export const SET_BASED_MIN_MS = 1_000;

/**
 * How a batch keeps to the import worker's time (docs/03-roadmap-appendix/phase1.md §6.3). The set-based try
 * has one deadline across all its statements, `budgetMs - ROW_BY_ROW_SLICE_MS` after the batch
 * began: before each statement the time left until it becomes the statement's timeout, and a
 * statement begun with none left is not run, so the try never runs past it. When the try is not
 * made (less than `SET_BASED_MIN_MS` left) or gives the batch up, a short row-by-row slice runs
 * the rows one at a time, looking at the time between rows: it stops after `ROW_BY_ROW_SLICE_MS`,
 * or once `budgetMs` has passed since the batch began, keeps the rows done so far as this batch
 * and leaves the rest for the next one. At least one row is always done, so every batch moves the
 * job on. `logger` records why a batch went row by row. Changed, these change every request the
 * process serves, so only `commit-job.ts` reads them and only tests change them, through
 * `@shakti/domain/testing` (both fenced by ESLint).
 */
export const importBatchSettings: {
  budgetMs: number;
  sliceMs: number;
  now: () => number;
  logger: Logger;
} = {
  budgetMs: IMPORT_BATCH_BUDGET_MS,
  sliceMs: ROW_BY_ROW_SLICE_MS,
  now: () => performance.now(),
  logger: jsonLogger(),
};
