import { describe, expect, it } from 'vitest';
import { maxDuration } from '../app/api/v1/workers/crm/rescore/route';
import { LEAD_RESCORE_RUN_BUDGET_MS } from './lead-rescore';

describe('the lead rescoring worker keeps to its route’s time', () => {
  it('leaves twenty seconds for the batch started last and the hand-over to the next run', () => {
    expect(LEAD_RESCORE_RUN_BUDGET_MS).toBeLessThanOrEqual(maxDuration * 1000 - 20_000);
  });
});
