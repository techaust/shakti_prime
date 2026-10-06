import { IMPORT_BATCH_BUDGET_MS, ROW_BY_ROW_SLICE_MS, SET_BASED_MIN_MS } from '@shakti/domain';
import { importBatchSettings } from '@shakti/domain/testing';
import { describe, expect, it } from 'vitest';
import { maxDuration } from '../app/api/v1/workers/imports/commit/route';
import { IMPORT_RUN_BUDGET_MS } from './imports';

describe('the import worker keeps to its route’s time', () => {
  it('aims to end a batch started at the end of the run budget within 50 seconds (a target, not a bound the platform enforces)', () => {
    // The run stops starting batches after its budget; the last one keeps to its own budget
    // (one deadline across its set-based try, then a short row-by-row slice) and may do one more
    // row. Ten seconds are left for that row and the hand-over to the next run.
    expect(importBatchSettings.budgetMs).toBe(IMPORT_BATCH_BUDGET_MS);
    expect(IMPORT_RUN_BUDGET_MS + IMPORT_BATCH_BUDGET_MS).toBeLessThanOrEqual(
      maxDuration * 1000 - 10_000,
    );
  });

  it('a batch begun on time has room for a set-based try and its row-by-row slice', () => {
    // The set-based deadline keeps the slice's time back from the budget; a budget no longer
    // than the two would send every batch row by row.
    expect(importBatchSettings.sliceMs).toBe(ROW_BY_ROW_SLICE_MS);
    expect(ROW_BY_ROW_SLICE_MS + SET_BASED_MIN_MS).toBeLessThan(IMPORT_BATCH_BUDGET_MS);
    // The set-based try keeps most of the budget: well over the median batch of 1.3 seconds
    // (docs/04-architecture-appendix/import-scale.md).
    expect(IMPORT_BATCH_BUDGET_MS - ROW_BY_ROW_SLICE_MS).toBeGreaterThanOrEqual(15_000);
  });
});
