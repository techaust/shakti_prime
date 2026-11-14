import { UNSOURCED } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { answerFigures, answerParts, citationNumbers, sourceHref, UNSOURCED_MARK } from './ask';

const A = '01990000-0000-7000-8000-00000000a001';
const B = '01990000-0000-7000-8000-00000000a002';

describe('an answer on screen', () => {
  it('reads the filter’s own mark', () => {
    expect(UNSOURCED_MARK).toBe(UNSOURCED);
  });

  it('turns citations into links and a taken-out figure into its own part, never raw text', () => {
    const parts = answerParts(`The quote [ref:${A}] is for [unsourced].\n\nThe lead [ref:${B}].`);
    expect(parts).toEqual([
      [
        { kind: 'text', text: 'The quote ' },
        { kind: 'cite', id: A },
        { kind: 'text', text: ' is for ' },
        { kind: 'unsourced' },
        { kind: 'text', text: '.' },
      ],
      [
        { kind: 'text', text: 'The lead ' },
        { kind: 'cite', id: B },
        { kind: 'text', text: '.' },
      ],
    ]);
    const text = parts
      .flat()
      .flatMap((p) => (p.kind === 'text' ? [p.text] : []))
      .join('');
    expect(text).not.toMatch(/\[ref:|\[unsourced\]/);
  });

  it('keeps each list line its own paragraph', () => {
    expect(answerParts('Open leads:\n1. Six in New\n2. Two in Qualified')).toHaveLength(3);
  });

  it('numbers the cited records in order of first citation', () => {
    expect([...citationNumbers(`[ref:${B}] [ref:${A}] [ref:${B}]`)]).toEqual([
      [B, 1],
      [A, 2],
    ]);
  });

  it('opens each kind of record where the person may open it, and nothing they can no longer read', () => {
    const base = { entityId: 2, accountId: B, label: 'SS/Q/2026-27/0012' };
    expect(sourceHref({ ...base, kind: 'quote', id: A })).toBe(`/quotes/2/${A}`);
    expect(sourceHref({ ...base, kind: 'sales_order', id: A })).toBe(`/orders/2/${A}`);
    expect(sourceHref({ ...base, kind: 'opportunity', id: A })).toBe(`/customers/${B}`);
    expect(sourceHref({ ...base, kind: 'playbook_directive', id: A })).toBeUndefined();
    expect(sourceHref({ ...base, kind: 'quote', id: A, label: null })).toBeUndefined();
  });

  it('shows rupee amounts and percentages as cards with the record their sentence cites', () => {
    expect(
      answerFigures(
        `The quote [ref:${A}] is for ₹1,20,000. Calls are at 80% of target. Again ₹1,20,000.`,
      ),
    ).toEqual([
      { value: '₹1,20,000', sourceId: A },
      { value: '80%', sourceId: undefined },
    ]);
  });
});
