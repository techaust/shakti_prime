import type { PlaybookReviewDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { approvable, openPairs, playbookShortcut, stepDirective } from './playbook';

const key = (k: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

const ID = (n: number) => `01990000-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;

function review(over: {
  state?: 'draft' | 'approved' | 'retired';
  checked?: boolean;
  pairs?: { label: 'conflict' | 'overlap' | 'none' | null; resolved?: boolean }[];
}): PlaybookReviewDto {
  return {
    directive: {
      id: ID(1),
      entityId: 1,
      type: 'faq',
      audience: 'staff',
      title: 'Rule',
      text: 'Text',
      sourceFileId: null,
      sourcePosition: null,
      state: over.state ?? 'draft',
      approvedBy: null,
      approvedAt: null,
      retiredReason: null,
      retiredAt: null,
      conflictsWith: [],
      checkedAt: over.checked === false ? null : '2026-11-13T00:00:00.000Z',
      createdBy: ID(2),
      createdAt: '2026-11-13T00:00:00.000Z',
      updatedAt: '2026-11-13T00:00:00.000Z',
    },
    source: null,
    pairs: (over.pairs ?? []).map((p, i) => ({
      check: {
        id: ID(10 + i),
        directiveId: ID(1),
        otherId: ID(20 + i),
        distance: 0.1,
        label: p.label,
        reason: p.label === null ? null : 'Why',
        resolution: p.resolved === true ? 'not_a_conflict' : null,
        resolutionNote: p.resolved === true ? 'Note' : null,
        resolvedBy: p.resolved === true ? ID(2) : null,
        resolvedAt: p.resolved === true ? '2026-11-13T00:00:00.000Z' : null,
      },
      other: null,
    })),
  };
}

describe('the Playbook keys', () => {
  it('reads J, K and A in either case, never with a modifier', () => {
    expect(playbookShortcut(key('j'))).toBe('next');
    expect(playbookShortcut(key('K'))).toBe('previous');
    expect(playbookShortcut(key('a'))).toBe('approve');
    expect(playbookShortcut(key('a', { ctrlKey: true }))).toBeUndefined();
    expect(playbookShortcut(key('x'))).toBeUndefined();
  });

  it('moves through the list and stays at either end', () => {
    const list = [{ id: ID(1) }, { id: ID(2) }, { id: ID(3) }];
    expect(stepDirective(list, undefined, 1)).toBe(ID(1));
    expect(stepDirective(list, ID(1), 1)).toBe(ID(2));
    expect(stepDirective(list, ID(3), 1)).toBe(ID(3));
    expect(stepDirective(list, ID(1), -1)).toBe(ID(1));
    expect(stepDirective([], ID(1), 1)).toBeUndefined();
  });
});

describe('what blocks approval on screen', () => {
  it('waits for the check and for every open or unlabelled pair', () => {
    expect(approvable(review({}))).toBe(true);
    expect(approvable(review({ checked: false }))).toBe(false);
    expect(approvable(review({ state: 'approved' }))).toBe(false);
    expect(
      approvable(review({ pairs: [{ label: 'none' }, { label: 'conflict', resolved: true }] })),
    ).toBe(true);
    expect(
      openPairs(review({ pairs: [{ label: null }, { label: 'overlap' }, { label: 'none' }] })),
    ).toHaveLength(2);
  });
});
