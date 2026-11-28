import { describe, expect, it } from 'vitest';
import { claimSteps, warrantyClaimHref, warrantyListHref } from './warranty';

describe('the warranty screens', () => {
  it('address the list by company and state, and a claim by company', () => {
    expect(warrantyListHref(2)).toBe('/inventory/warranty?company=2');
    expect(warrantyListHref(2, 'rma_raised')).toBe(
      '/inventory/warranty?company=2&state=rma_raised',
    );
    expect(warrantyClaimHref(1, 'c1')).toBe('/inventory/warranty/c1?company=1');
  });

  it('mark each step up to the claim done and the one after it next', () => {
    const statuses = (state: Parameters<typeof claimSteps>[0]) =>
      claimSteps(state).map(({ step, status }) => `${step}:${status}`);
    expect(statuses('raised')).toEqual([
      'raised:done',
      'serial_identified:current',
      'replacement_issued:next',
      'rma_raised:next',
      'closed:next',
    ]);
    expect(statuses('serial_identified')).toEqual([
      'raised:done',
      'serial_identified:done',
      'replacement_issued:current',
      'rma_raised:next',
      'closed:next',
    ]);
    expect(statuses('rma_raised').slice(3)).toEqual(['rma_raised:done', 'closed:current']);
    expect(statuses('closed').every((s) => s.endsWith(':done'))).toBe(true);
  });

  it('end a rejected claim at its rejection, with no step still to come', () => {
    expect(claimSteps('rejected')).toEqual([
      { step: 'raised', status: 'done' },
      { step: 'rejected', status: 'done' },
    ]);
  });
});
