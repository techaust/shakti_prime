import { newId, type AskSource } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { citationMarker, collectFigures, groundAnswer, UNSOURCED } from './grounding';

// The grounding filter (docs/03-roadmap-appendix/phase2.md §6.5, §14), closed by default: a
// citation only of a record a lookup returned in the conversation; a figure only one of the same
// kind and value a lookup returned in the turn, the question holds or today is; anything
// number-like it cannot read with confidence is taken out. The lookups' answers below are shaped
// as the lookups write them (amounts after ₹, counts as numbers, dates as days, document numbers
// in their own fields, ids beside them).

const QUOTE: AskSource = { kind: 'quote', id: '01990000-0000-7000-8000-00000000a001' };
const LEAD: AskSource = { kind: 'opportunity', id: '01990000-0000-7000-8000-00000000a002' };
const NOT_RETURNED = '01990000-0000-7000-8000-00000000ffff';

const returned = new Map([QUOTE, LEAD].map((s) => [s.id, s]));

function ground(answer: string, results: readonly string[]) {
  return groundAnswer(answer, { returned, figures: collectFigures(results) });
}

/** The lookups of most cases: a quote, its lead's stage, a target and this month's sales. */
const LOOKUPS = [
  JSON.stringify({
    quotes: [
      {
        ref: QUOTE.id,
        lead: LEAD.id,
        number: 'SS/Q/2026-27/0012',
        grandTotal: '₹120000.00',
        made: '2026-11-14',
        validUntil: '2026-11-30',
      },
    ],
  }),
  JSON.stringify({ stages: [{ ref: newId(), stage: 'New', openLeads: 23 }, { openLeads: 7 }] }),
  JSON.stringify({
    mine: [{ metrics: [{ metric: 'calls', target: 40, actual: 32, percentOfTarget: 80 }] }],
  }),
  JSON.stringify({
    companies: [{ ordersConfirmedValue: '₹50000.00', ordersConfirmedThisMonth: 4 }],
  }),
];

describe('figures that pass', () => {
  it.each([
    ['a rupee total', 'The quote is for ₹1,20,000.'],
    ['the same total in lakh', 'The quote is for ₹1.2 lakh.'],
    ['the same total after Rs', 'The quote is for Rs. 1,20,000.00.'],
    ['the same total before rupees', 'The quote is for 1,20,000 rupees.'],
    ['a percentage', 'Calls are at 80% of target.'],
    ['a percentage in words', 'Calls are at 80 percent of target.'],
    ['a count', 'There are 23 open leads.'],
    ['another count', 'Calls stand at 32 against a target of 40 calls.'],
    ['a date in every common form', 'It is valid until 30-11-2026, made on 14 November 2026.'],
    ['a month and a day', 'It was made in November 2026, on 14th Nov.'],
    ['a quote number, whole', 'The newest is SS/Q/2026-27/0012.'],
    ['an amount of this month', 'Orders confirmed this month come to ₹50,000.'],
    ['the same amount with its magnitude', 'Orders confirmed this month come to ₹50 thousand.'],
    ['a list counting up from 1', 'Open leads:\n1. New has 23 open leads\n2. Others hold 7 leads'],
    ['a second list from 1', 'A:\n1. first\n2. second\nB:\n1. third'],
    ['words with no figure', 'The one in Jaipur is waiting, and I do not see a quote for it.'],
  ])('%s', (_name, answer) => {
    expect(ground(answer, LOOKUPS)).toEqual({ text: answer, cited: [], unsourced: 0 });
  });

  it('keeps citations of returned records, each once, in order, and never reads an id as a figure', () => {
    const answer = `The quote [ref:${QUOTE.id}] of the lead [REF: ${LEAD.id.toUpperCase()}] is for ₹1,20,000 [ref:${QUOTE.id}].`;
    expect(ground(answer, LOOKUPS)).toEqual({
      text: `The quote ${citationMarker(QUOTE.id)} of the lead ${citationMarker(LEAD.id)} is for ₹1,20,000 ${citationMarker(QUOTE.id)}.`,
      cited: [QUOTE, LEAD],
      unsourced: 0,
    });
  });

  it('allows a figure the person wrote in the question, and today', () => {
    expect(ground('Leads above 5 HP: none.', ['Which leads are above 5 HP?']).unsourced).toBe(0);
    expect(ground('Today, 15-11-2026, none is due.', ['2026-11-15']).unsourced).toBe(0);
  });

  it('reads digits of every script as their ASCII digits, on both sides', () => {
    expect(ground('There are २३ open leads.', LOOKUPS).text).toBe('There are 23 open leads.');
    expect(ground('There are ２３ open leads.', LOOKUPS).unsourced).toBe(0);
    expect(ground('There are 23 open leads.', ['{"openLeads":"２３ open leads"}']).unsourced).toBe(
      0,
    );
  });
});

describe('figures refused (review finding 1, the re-check and finding 10)', () => {
  it.each([
    // Magnitude words the filter does not read with confidence.
    ['₹7 hazaar'],
    ['₹7 arab'],
    ['50 sau rupees'],
    ['₹7 thousands'],
    ['seven hundreds'],
    ['seven-thousand rupees'],
    ['₹7-thousand'],
    ['₹7 lakh crore'],
    ['a lakh rupees'],
    ['a dozen orders'],
    ['₹7k'],
    ['7 million rupees'],
    ['fifty lakh'],
    ['seven gazillion'],
    ['do sau rupaye'],
    ['ek crore'],
    ['twenty-three open leads'],
    // A figure of the wrong kind, or a part of another.
    ['The margin is 23%.'],
    ['The margin is 7 percent.'],
    ['The rate is ₹23 a kit.'],
    ['There are 50000 open leads.'],
    ['There are 2026 open leads.'],
    ['There are 27 open leads.'],
    ['There are 12 dealers.'],
    ['The newest is SS/Q/2026-27/0013.'],
    // A bare number, and numbers in other scripts that no lookup gave.
    ['A total of 9.'],
    ['Total: ३१२५० rupees.'],
    ['Total: ３１２５０ rupees.'],
  ])('%s', (answer) => {
    const grounded = ground(answer, LOOKUPS);
    expect(grounded.unsourced).toBeGreaterThan(0);
    expect(grounded.text).toContain(UNSOURCED);
    expect(grounded.text).not.toMatch(
      /\d|hazaar|arab|sau|thousand|lakh|crore|dozen|seven|fifty|gazillion|twenty|ek |do sau|million|k\b/i,
    );
  });

  it.each([
    ['Profit:\n1. crore rupees'],
    ['1. a\n2. b\n3. lakh rupees'],
    ['Margin:\n23. percent of the price'],
    ['Steps:\n1. Call\n3. Quote'],
  ])('a line-start number before a magnitude, or out of a run from 1: %j', (answer) => {
    const grounded = ground(answer, LOOKUPS);
    expect(grounded.unsourced).toBeGreaterThan(0);
    // The list's own numbering stays; the figure written as one does not.
    expect(grounded.text.split('\n').at(-1)).not.toMatch(/\d|crore|lakh/);
  });

  it('refuses a magnitude the lookups did not give, which they would have to give whole', () => {
    const small = [JSON.stringify({ count: 7, value: 50, total: '₹50.00' })];
    for (const answer of [
      'Sales were ₹50 thousand.',
      'Sales were ₹7k.',
      'Sales were 7 million rupees.',
    ]) {
      expect({ answer, unsourced: ground(answer, small).unsourced }).toEqual({
        answer,
        unsourced: 1,
      });
    }
  });

  it('never takes a figure from the digits of the ids beside the values', () => {
    const results = [
      JSON.stringify({
        leads: Array.from({ length: 25 }, () => ({ ref: newId(), lead: newId(), score: 40 })),
      }),
    ];
    expect(ground('There are 7 open leads.', results).text).toBe(
      `There are ${UNSOURCED} open leads.`,
    );
    expect([...collectFigures(results)]).toEqual(['n:40']);
  });

  it('takes out a citation of a record no lookup returned, marked or bare', () => {
    const grounded = ground(`See [ref:${NOT_RETURNED}] and ${NOT_RETURNED}.`, LOOKUPS);
    expect(grounded.text).toBe(`See ${UNSOURCED} and ${UNSOURCED}.`);
    expect(grounded.unsourced).toBe(2);
  });

  it('drops characters that could pass for its own stand-ins', () => {
    expect(ground('A\ue000 total of 9.', []).text).toBe(`A total of ${UNSOURCED}.`);
  });

  it('gives a day its month and its day and month, but no bare year', () => {
    expect([...collectFigures(['{"on":"2026-11-14"}'])].sort()).toEqual(
      ['date:2026-11-14', 'month:2026-11', 'daymonth:11-14'].sort(),
    );
  });
});

describe('the second re-check: rows A and B', () => {
  /** The re-check's lookups, written as the tools write them. */
  const RECHECK = [
    JSON.stringify({ stages: [{ ref: LEAD.id, stage: 'New', openLeads: 7 }, { openLeads: 23 }] }),
    JSON.stringify({
      quotes: [
        {
          ref: QUOTE.id,
          number: 'SS/Q/2026-27/0012',
          grandTotal: '₹50000.00',
          made: '2026-11-14',
          validUntil: '2026-11-30',
        },
      ],
    }),
    JSON.stringify({ companies: [{ ordersConfirmedValue: '₹7.00', quotesSentWaiting: 12 }] }),
    JSON.stringify({ mine: [{ metrics: [{ target: 100, actual: 80, percentOfTarget: 80 }] }] }),
    JSON.stringify({ rules: [{ text: 'Install within 30 days of the order. Warranty 5 years.' }] }),
  ];
  /** The same without any amount of 7, for the unit words that would otherwise be ₹7. */
  const COUNTS_ONLY = [JSON.stringify({ openLeads: 7, percentOfTarget: 80 })];

  it.each([
    ['₹7 karod', RECHECK],
    ['₹7 karor', RECHECK],
    ['₹7 hajaar', RECHECK],
    ['₹7 laakh', RECHECK],
    ['Rs. 7 grand', RECHECK],
    ['7 karod rupees', RECHECK],
    ['1. karod rupees', RECHECK],
    ['There are zero open leads.', RECHECK],
    ['Nothing: shunya.', RECHECK],
    ['₹7 crores', RECHECK],
    ['₹7 hazaars', RECHECK],
    ['Margin 7 pct.', COUNTS_ONLY],
    ['Margin 7 percentage points.', COUNTS_ONLY],
    ['Margin 80 percentage points.', COUNTS_ONLY],
    ['It costs 7 rupiya.', COUNTS_ONLY],
    ['It costs 7 rupaiya.', COUNTS_ONLY],
    ['It costs 7 rupaye.', COUNTS_ONLY],
    ['It costs ₹7 kits.', RECHECK],
  ])('refuses %j', (answer, lookups) => {
    const grounded = ground(answer, lookups);
    expect(grounded.unsourced).toBeGreaterThan(0);
    expect(grounded.text).not.toMatch(
      /\d|karod|karor|hajaar|laakh|grand|zero|shunya|crores|hazaars/i,
    );
  });

  it.each([
    [`New has 7 open leads [ref:${LEAD.id}].`],
    ['Quote SS/Q/2026-27/0012 is for ₹50,000 and is valid until 30-11-2026.'],
    ['Orders come to ₹50 thousand.'],
    ['Orders confirmed this month come to ₹7.00.'],
    ['You are at 80% of your calls target, 80 of 100 calls.'],
    ['Install within 30 days; it was made on 14 November 2026.'],
    ['It is Rs. 50,000/- in all.'],
    ['There are 12 quotes waiting.'],
    ['Stages:\n1. New\n2. Qualified'],
  ])('still passes %j', (answer) => {
    expect(ground(answer, RECHECK).unsourced).toBe(0);
  });

  it('matches a count by its number and kind only, not by what it counts', () => {
    // Documented in SECURITY §3.2: "30 years" is sourced by "30 days".
    expect(ground('Warranty is 30 years.', RECHECK).unsourced).toBe(0);
  });
});
