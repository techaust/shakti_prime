import { describe, expect, it } from 'vitest';
import { claimStepStatus, warrantyClaimHref, warrantyListHref } from './warranty';

describe('the warranty screens', () => {
  it('address the list by company and state, and a claim by company', () => {
    expect(warrantyListHref(2)).toBe('/inventory/warranty?company=2');
    expect(warrantyListHref(2, 'rma_raised')).toBe(
      '/inventory/warranty?company=2&state=rma_raised',
    );
    expect(warrantyClaimHref(1, 'c1')).toBe('/inventory/warranty/c1?company=1');
  });

  it('mark each step done, current or still to come', () => {
    expect(claimStepStatus('raised', 'serial_identified')).toBe('done');
    expect(claimStepStatus('serial_identified', 'serial_identified')).toBe('current');
    expect(claimStepStatus('closed', 'rma_raised')).toBe('next');
    expect(claimStepStatus('closed', 'closed')).toBe('done');
    expect(claimStepStatus('raised', 'rejected')).toBe('done');
    expect(claimStepStatus('serial_identified', 'rejected')).toBe('next');
  });
});
