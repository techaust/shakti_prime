import { describe, expect, it } from 'vitest';
import { maxDuration } from '../app/api/v1/workers/crm/duplicates/route';
import { DUPLICATE_SCAN_RUN_BUDGET_MS } from './duplicate-scan';

describe('the duplicate search keeps to its route’s time', () => {
  it('leaves twenty seconds for the batch started last and the hand-over to the next run', () => {
    expect(DUPLICATE_SCAN_RUN_BUDGET_MS).toBeLessThanOrEqual(maxDuration * 1000 - 20_000);
  });
});
