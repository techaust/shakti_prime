import type { AskSource } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { citationMarker, collectFigures, groundAnswer, UNSOURCED } from './grounding';

// The grounding filter (docs/03-roadmap-appendix/phase2.md §6.5, §14): a citation only of a record
// a lookup returned in the conversation, a figure only one a lookup returned in the turn or the
// question holds; whatever fails never reaches the person.

const QUOTE: AskSource = { kind: 'quote', id: '01990000-0000-7000-8000-00000000a001' };
const LEAD: AskSource = { kind: 'opportunity', id: '01990000-0000-7000-8000-00000000a002' };
const NOT_RETURNED = '01990000-0000-7000-8000-00000000ffff';

const returned = new Map([QUOTE, LEAD].map((s) => [s.id, s]));

function ground(answer: string, results: readonly string[]) {
  return groundAnswer(answer, { returned, figures: collectFigures(results) });
}

describe('groundAnswer', () => {
  it('keeps an answer whose citations were returned and whose figures a lookup gave', () => {
    const results = [
      JSON.stringify({
        quotes: [{ ref: QUOTE.id, grandTotal: '120000.00', validUntil: '2026-11-30' }],
      }),
      JSON.stringify({ leads: 12 }),
    ];
    const answer = `There are 12 leads. The quote [ref:${QUOTE.id}] is for ₹1,20,000 and is valid until 30-11-2026.`;
    expect(ground(answer, results)).toEqual({ text: answer, cited: [QUOTE], unsourced: 0 });
  });

  it('reads amounts in lakh and crore, words for counts, and dates in every common form', () => {
    const results = [
      JSON.stringify({ total: '250000.00', big: '30000000.00', count: 25, day: '2026-11-14' }),
    ];
    for (const answer of [
      'The total is ₹2.5 lakh.',
      'The total is Rs. 2,50,000.00.',
      'The big order is ₹3 crore.',
      'Twenty-five leads are open.',
      'It came on 14 November 2026.',
      'It came on Nov 14, 2026.',
      'It came on 14/11/2026.',
      'It came in November 2026.',
      'It came on 14th Nov.',
    ]) {
      expect(ground(answer, results)).toEqual({ text: answer, cited: [], unsourced: 0 });
    }
  });

  it('takes out a figure no lookup gave and says so, never showing it', () => {
    const results = [JSON.stringify({ grandTotal: '120000.00', leads: 12 })];
    const answer = 'There are 12 leads worth about ₹1.5 lakh, with 7 due on 20-11-2026.';
    const grounded = ground(answer, results);
    expect(grounded.text).toBe(
      `There are 12 leads worth about ${UNSOURCED}, with ${UNSOURCED} due on ${UNSOURCED}.`,
    );
    expect(grounded.unsourced).toBe(3);
    expect(grounded.text).not.toMatch(/1\.5|20-11|\b7\b/);
  });

  it('takes out a citation of a record no lookup returned, marked or bare', () => {
    const grounded = ground(
      `See [ref:${NOT_RETURNED}] and ${NOT_RETURNED}, and the lead ${LEAD.id}.`,
      [],
    );
    expect(grounded.text).toBe(
      `See ${UNSOURCED} and ${UNSOURCED}, and the lead ${citationMarker(LEAD.id)}.`,
    );
    expect(grounded.cited).toEqual([LEAD]);
    expect(grounded.unsourced).toBe(2);
  });

  it('lists each cited record once, in order, and never reads an id as a figure', () => {
    const grounded = ground(
      `[ref: ${LEAD.id}] then [REF:${QUOTE.id.toUpperCase()}] then [ref:${LEAD.id}]`,
      [],
    );
    expect(grounded.cited).toEqual([LEAD, QUOTE]);
    expect(grounded.unsourced).toBe(0);
    expect(grounded.text).toBe(
      `${citationMarker(LEAD.id)} then ${citationMarker(QUOTE.id)} then ${citationMarker(LEAD.id)}`,
    );
  });

  it('allows a figure the person wrote in the question, and a list’s own numbering', () => {
    const answer = 'Leads above 5 HP:\n1. one lead in Jaipur\n2. none elsewhere';
    expect(ground(answer, ['Which leads are above 5 HP?'])).toEqual({
      text: answer,
      cited: [],
      unsourced: 0,
    });
  });

  it('compares document numbers in the same form on both sides', () => {
    const results = [JSON.stringify({ number: 'SS/Q/2026-27/0012' })];
    expect(ground('Quote SS/Q/2026-27/0012 is the newest.', results).unsourced).toBe(0);
    expect(ground('Quote SS/Q/2026-27/0013 is the newest.', results).unsourced).toBe(1);
  });

  it('drops characters that could pass for its own stand-ins', () => {
    const grounded = ground('A total of 9.', []);
    expect(grounded.text).toBe(`A total of ${UNSOURCED}.`);
  });

  it('gives each day its month, day and year as sourced figures', () => {
    const keys = collectFigures(['{"on":"2026-11-14T05:30:00Z"}']);
    expect([...keys].sort()).toEqual(
      ['date:2026-11-14', 'month:2026-11', 'daymonth:11-14', 'n:2026'].sort(),
    );
  });
});
