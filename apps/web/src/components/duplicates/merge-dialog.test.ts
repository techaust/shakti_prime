import { DuplicateRowDto, type DuplicateSideDto } from '@shakti/contracts';
import { describe, expect, it, vi } from 'vitest';
import { openLeadOf } from './merge-dialog';

vi.mock('../../actions/duplicates', () => ({
  mergeCustomers: vi.fn(),
  mergeLeads: vi.fn(),
  previewCustomerMerge: vi.fn(),
}));

type LeadState = DuplicateSideDto['opportunityState'];

function side(n: number, state: LeadState): DuplicateSideDto {
  return {
    accountId: '01990000-0000-7000-8000-00000000b001',
    accountName: 'Meera',
    accountType: 'farm',
    phoneLast4: '4321',
    village: null,
    entityIds: [1],
    opportunityId: `01990000-0000-7000-8000-00000000c00${n}`,
    pipelineName: 'Farmer pumps',
    stageName: 'New',
    opportunityState: state,
    ownerName: null,
  };
}

function row(kind: 'customer' | 'lead', first: LeadState, second: LeadState): DuplicateRowDto {
  return DuplicateRowDto.parse({
    id: '01990000-0000-7000-8000-00000000d001',
    entityId: 1,
    kind,
    reason: 'phone',
    signals: ['same_customer', 'same_phone'],
    confidence: 95,
    state: 'open',
    createdAt: '2026-10-06T04:30:00.000Z',
    first: side(1, first),
    second: side(2, second),
  });
}

describe('openLeadOf', () => {
  it('keeps the open lead of an open lead and a lead in nurture, whichever side it is', () => {
    expect(openLeadOf(row('lead', 'open', 'nurture'))).toBe('first');
    expect(openLeadOf(row('lead', 'nurture', 'open'))).toBe('second');
  });

  it('leaves the choice to the caller for two open leads and for customers', () => {
    expect(openLeadOf(row('lead', 'open', 'open'))).toBeUndefined();
    expect(openLeadOf(row('lead', 'nurture', 'nurture'))).toBeUndefined();
    expect(openLeadOf(row('customer', null, null))).toBeUndefined();
  });
});
