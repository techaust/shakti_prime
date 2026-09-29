import { IMPORT_BATCH_BUDGET_MS, SET_BASED_BATCH_BOUND_MS } from '@shakti/domain';
import { importBatchSettings } from '@shakti/domain/testing';
import { describe, expect, it } from 'vitest';
import { maxDuration } from '../app/api/v1/workers/imports/commit/route';
import { IMPORT_RUN_BUDGET_MS } from './imports';

describe('the import worker keeps to its route’s time', () => {
  it('aims to end a batch started at the end of the run budget within 50 seconds (a target, not a bound the platform enforces)', () => {
    // The run stops starting batches after its budget; the last one keeps to its own budget
    // (a set-based try only while the slowest measured one fits, row by row between rows) and
    // may do one more row. Ten seconds are left for that row and the hand-over to the next run.
    expect(importBatchSettings.budgetMs).toBe(IMPORT_BATCH_BUDGET_MS);
    expect(IMPORT_RUN_BUDGET_MS + IMPORT_BATCH_BUDGET_MS).toBeLessThanOrEqual(
      maxDuration * 1000 - 10_000,
    );
  });

  it('a batch begun on time has room for a set-based try inside its budget', () => {
    // A set-based try is made only while this much of the batch's budget is left, so a budget
    // no longer than the bound would send every batch row by row.
    expect(SET_BASED_BATCH_BOUND_MS).toBeLessThan(IMPORT_BATCH_BUDGET_MS);
  });
});
