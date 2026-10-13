import { memoryKeyValue, type KeyValue } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import { memoryAlertSink } from '../observability/alerts';
import { FAILING_CALLS_ALERT, recordJobOutcome } from './job-streak';

describe('recordJobOutcome (audit 2026-10, OPS-3)', () => {
  it('tells the owner once, on the third failed call in a row', async () => {
    const keyValue = memoryKeyValue();
    const alerts = memoryAlertSink();
    for (let call = 1; call <= FAILING_CALLS_ALERT + 2; call += 1) {
      await recordJobOutcome('quote-expire', 'failed', { requestId: `r${String(call)}`, keyValue, alerts });
    }
    expect(alerts.alerts).toEqual([{ name: 'job.failing', fields: { job: 'quote-expire', runs: 3 } }]);
  });

  it('starts the count again after a call that did its work, and keeps each job apart', async () => {
    const keyValue = memoryKeyValue();
    const alerts = memoryAlertSink();
    const options = { requestId: 'r', keyValue, alerts };
    await recordJobOutcome('files-sweep', 'failed', options);
    await recordJobOutcome('files-sweep', 'failed', options);
    await recordJobOutcome('lead-rescore', 'failed', options);
    await recordJobOutcome('files-sweep', 'ok', options);
    await recordJobOutcome('files-sweep', 'failed', options);
    await recordJobOutcome('files-sweep', 'failed', options);
    expect(alerts.alerts).toEqual([]);
    await recordJobOutcome('files-sweep', 'failed', options);
    expect(alerts.alerts).toEqual([{ name: 'job.failing', fields: { job: 'files-sweep', runs: 3 } }]);
  });

  it('never fails the call when the store does not answer', async () => {
    const broken: KeyValue = {
      ...memoryKeyValue(),
      incr: () => Promise.reject(new Error('store down')),
      del: () => Promise.reject(new Error('store down')),
    };
    const alerts = memoryAlertSink();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      recordJobOutcome('notification-scan', 'failed', { requestId: 'r', keyValue: broken, alerts }),
    ).resolves.toBeUndefined();
    await expect(
      recordJobOutcome('notification-scan', 'ok', { requestId: 'r', keyValue: broken, alerts }),
    ).resolves.toBeUndefined();
    expect(alerts.alerts).toEqual([]);
  });
});
