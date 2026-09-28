import { importBatchSettings } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { maxDuration } from '../app/api/v1/workers/imports/commit/route';
import { IMPORT_RUN_BUDGET_MS } from './imports';

describe('the import worker keeps to its route’s time', () => {
  it('a batch started at the end of the run budget still ends well inside maxDuration', () => {
    // The run stops starting batches after its budget; the last one may run for its own budget
    // and then one more row. Ten seconds are left for the hand-over to the next run.
    expect(IMPORT_RUN_BUDGET_MS + importBatchSettings.budgetMs).toBeLessThanOrEqual(
      maxDuration * 1000 - 10_000,
    );
  });
});
