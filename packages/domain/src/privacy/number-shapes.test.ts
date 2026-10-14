import { describe, expect, it } from 'vitest';
import { redactForAudit } from '../audit/redact';
import { maskIdentityText, withoutIdentityNumbers } from '../imports/identity-columns';
import { redactText } from '../ports/redaction';
import { maskForModel } from './model-text';
import { asciiDigits, findPersonalNumbers } from './number-shapes';

/**
 * Every shape the audit's verifier ran through `redactText()` and found unchanged (audit SEC-3,
 * `docs/14-reviews/2026-10-audit/1-security.verdict.md`), with the shapes printed most often, each
 * with the number's digits and the kind it is. One table, run against the log and audit scrubber
 * and the model masker alike.
 */
const SHAPES: readonly { text: string; digits: string; kind: 'aadhaar' | 'phone' }[] = [
  { text: 'Aadhaar no. 2345.6789.0123', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar 2345_6789_0123 on file', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar 2345,6789,0123 on file', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar (2345) 6789 0123 on file', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar 2345/6789/0123 on file', digits: '234567890123', kind: 'aadhaar' },
  { text: 'card A234567890123 seen', digits: '234567890123', kind: 'aadhaar' },
  { text: 'UID234567890123', digits: '234567890123', kind: 'aadhaar' },
  // Devanagari and full-width digits, written as the verifier wrote them.
  { text: 'आधार २३४५ ६७८९ ०१२३', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar ２３４５ ６７８９ ０１２３', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar ２３４５６７８９０１２３', digits: '234567890123', kind: 'aadhaar' },
  // Gujarati digits, and a tab and a non-breaking space between the groups.
  { text: 'આધાર ૨૩૪૫ ૬૭૮૯ ૦૧૨૩', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar 2345\t6789 0123', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar 2345 6789 0123', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar 2345-6789-0123', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar 234567890123', digits: '234567890123', kind: 'aadhaar' },
  { text: 'Aadhaar 2345 67890123', digits: '234567890123', kind: 'aadhaar' },
  { text: 'call 98765.43210 today', digits: '9876543210', kind: 'phone' },
  { text: 'call 9876543210x today', digits: '9876543210', kind: 'phone' },
  { text: 'Mob9876543210', digits: '9876543210', kind: 'phone' },
  { text: 'call 98765_43210 today', digits: '9876543210', kind: 'phone' },
  { text: 'call (98765) 43210 today', digits: '9876543210', kind: 'phone' },
  { text: 'call ९८७६५ ४३२१० today', digits: '9876543210', kind: 'phone' },
  { text: 'call +91 98765 43210 today', digits: '919876543210', kind: 'phone' },
];

/** The digits a text still shows, in ASCII, whatever script they were written in. */
const digitsLeft = (text: string): string => asciiDigits(text).replace(/\D/g, '');

describe('the shapes of a personal number, read alike by the scrubber and the model masker', () => {
  it.each(SHAPES)('finds $text', ({ text, digits, kind }) => {
    const found = findPersonalNumbers(text);
    expect(found.map((n) => ({ kind: n.kind, digits: n.digits }))).toEqual([{ kind, digits }]);
  });

  it.each(SHAPES)(
    'the logs and the audit trail keep no more than its last four: $text',
    (shape) => {
      const out = redactText(shape.text);
      // An Aadhaar number goes whole; a phone keeps its last four digits.
      const shown = digitsLeft(out);
      expect(shown).not.toContain(shape.digits.slice(0, -4));
      if (shape.kind === 'aadhaar') expect(out).toContain('[number]');
      else expect(shown.endsWith(shape.digits.slice(-4))).toBe(true);
      // As a typed note in an audit row too.
      const audited = JSON.stringify(redactForAudit({ input: { note: shape.text } }));
      expect(digitsLeft(audited)).not.toContain(shape.digits.slice(0, -4));
    },
  );

  it.each(SHAPES)('a model reads none of it: $text', (shape) => {
    const out = maskForModel(shape.text);
    expect(digitsLeft(out)).not.toContain(shape.digits.slice(-4));
    expect(out).toMatch(/\[(number|phone)\]/);
  });

  it('finds an Aadhaar number and a phone joined in one run, and never reads a phone into an Aadhaar number', () => {
    // A comma and a space join one run (second review, M7), so the phone goes with the number.
    expect(redactText('ids 2345 6789 0123, 9876543210 seen')).toBe('ids [number] seen');
    expect(redactText('ids 2345 6789 0123 and 9876543210 seen')).toBe(
      'ids [number] and ******3210 seen',
    );
    // The whole run is the number: a group joined before it is never left beside it.
    expect(redactText('91 2345 6789 0123')).toBe('[number]');
    expect(redactText('Aadhaar २३४५.६७८९.०१२३ and 98765-43210')).toBe(
      'Aadhaar [number] and ******3210',
    );
  });

  it('keeps ids, dates, times, amounts, quantities, codes and document numbers as written', () => {
    for (const text of [
      'lead 01928a3b-4c5d-7e6f-8a9b-234567890123 moved',
      'due 9/10/2026 7:15',
      'at 2026-09-27T10:00:00.000Z',
      'from 13-10-2026 10:00 to 14-10-2026 18:30',
      'quoted ₹1,45,000',
      'SP-7.5-100-2026',
      'ASH/Q/2026-27/0001',
      'SS/2026-27/000123',
      'order 1727430000000',
      'call 5123456789',
    ]) {
      expect(redactText(text)).toBe(text);
    }
  });

  it('answers the offsets of the number as written, for any script', () => {
    const text = 'नंबर २३४५ ६७८९ ०१२३ है';
    const [found] = findPersonalNumbers(text);
    expect(found).toBeDefined();
    expect(text.slice(found?.start, found?.end)).toBe('२३४५ ६७८९ ०१२३');
  });
});

/**
 * The review's shapes (14-10-2026): a number joined to another group (H1), after a `+` (H1), in
 * other groupings or with an invisible character inside (M2). One table, run against the import
 * filter, the scrubber and the model masker: each keeps at most the last four of the twelve.
 */
const REVIEW_SHAPES: readonly { text: string; number: string; imported: string }[] = [
  {
    text: 'DOB 12.05.1985, 2345 6789 0124',
    number: '234567890124',
    // A comma and a space join a run as any separator does (second review, M7).
    imported: 'DOB XX.XX.XXXX, XXXX XXXX 0124',
  },
  {
    text: '12051985 2345 6789 0124',
    number: '234567890124',
    imported: 'XXXXXXXX XXXX XXXX 0124',
  },
  {
    text: 'Plot 1234, 2345 6789 0124',
    number: '234567890124',
    imported: 'Plot XXXX, XXXX XXXX 0124',
  },
  { text: 'Aadhaar +2345-6789-0124', number: '234567890124', imported: 'Aadhaar +XXXX-XXXX-0124' },
  { text: 'Ram + 2345 6789 0124', number: '234567890124', imported: 'Ram + XXXX XXXX 0124' },
  { text: 'card 234 567 890 124', number: '234567890124', imported: 'card XXX XXX XX0 124' },
  { text: 'card 234567 890124', number: '234567890124', imported: 'card XXXXXX XX0124' },
  { text: 'card 23 45 67 89 01 24', number: '234567890124', imported: 'card XX XX XX XX 01 24' },
  { text: 'card 2345 6789 01 24', number: '234567890124', imported: 'card XXXX XXXX 01 24' },
  { text: 'card 234567‎890124', number: '234567890124', imported: 'card XXXXXX‎XX0124' },
  { text: 'card 2345​6789‍0124', number: '234567890124', imported: 'card XXXX​XXXX‍0124' },
  { text: 'card 2345 6789 0124', number: '234567890124', imported: 'card XXXX XXXX 0124' },
];

describe('the review shapes: the whole run, after a +, in any grouping, with invisible characters', () => {
  it.each(REVIEW_SHAPES)('the import keeps only the last four: $text', ({ text, imported }) => {
    expect(maskIdentityText(text)).toBe(imported);
  });

  it.each(REVIEW_SHAPES)('the scrubber and the model mask it: $text', ({ text, number }) => {
    for (const out of [
      redactText(text),
      maskForModel(text),
      JSON.stringify(redactForAudit({ input: { note: text } })),
    ]) {
      expect(digitsLeft(out)).not.toContain(number.slice(0, 8));
      expect(digitsLeft(out)).not.toContain(number.slice(4));
    }
  });

  it('counts a cell as hidden only when its number was removed', () => {
    const out = withoutIdentityNumbers(
      ['Name', 'Remarks'],
      [
        ['Ram', 'DOB 12.05.1985, 2345 6789 0124'],
        ['Sita', 'Ward 4 near the school'],
        ['Gopal', 'Plot 1234, gate on the left'],
      ],
    );
    expect(out.maskedValues).toBe(1);
    expect(out.rows[0]).toEqual(['Ram', 'DOB XX.XX.XXXX, XXXX XXXX 0124']);
  });

  it('leaves a +91 mobile number to the phone rules, and a + number of another country too', () => {
    expect(redactText('call +91 98765 43210')).toBe('call ********3210');
    expect(redactText('call +14155552671')).toBe('call +*******2671');
    expect(maskIdentityText('call +91 98765 43210')).toBe('call +91 98765 43210');
  });

  it('leaves numbers beginning 0 or 1 alone, and lists of them (review L6, M3)', () => {
    for (const text of [
      'qty 1000, 2000, 3000',
      'ids 1001/1002/1003',
      'ref 012345678901',
      'ref 112345678901',
    ]) {
      expect(redactText(text)).toBe(text);
      expect(maskIdentityText(text)).toBe(text);
    }
  });
});

/**
 * The second review's shapes (14-10-2026). M7: a comma and a space join a run for every consumer,
 * as they always did for the model masker. L9: more separators, more invisible characters, and
 * superscript digits. One table, run against the import filter, `redactText()`, the audit
 * scrubber and `maskForModel()`: one rule for all four.
 */
const SECOND_REVIEW_SHAPES: readonly { text: string; number: string }[] = [
  { text: 'Aadhaar 2345, 6789, 0124', number: '234567890124' },
  ...['"', '|', '*', '#', '~', '+', '=', '·', '•', '\\'].map((sep) => ({
    text: `card 2345${sep}6789${sep}0124`,
    number: '234567890124',
  })),
  ...['\u034f', '\ufe0f', '\u115f', '\u1160', '\u3164', '\uffa0', '\u2800'].map((mark) => ({
    text: `card 2345${mark}6789${mark}0124`,
    number: '234567890124',
  })),
  { text: 'card ²³⁴⁵⁶⁷⁸⁹⁰¹²⁴', number: '234567890124' },
];

describe('the second review: one rule for the import, the scrubber, the audit trail and the model', () => {
  it.each(SECOND_REVIEW_SHAPES)(
    'all four keep at most the last four: $text',
    ({ text, number }) => {
      for (const out of [
        maskIdentityText(text),
        redactText(text),
        JSON.stringify(redactForAudit({ input: { note: text } })),
        maskForModel(text),
      ]) {
        expect(digitsLeft(out)).not.toContain(number.slice(0, 8));
        expect(digitsLeft(out)).not.toContain(number.slice(4));
      }
    },
  );

  it('counts a superscript digit as a digit when it masks (L9)', () => {
    expect(maskIdentityText('card 2345 6789 01²⁴')).toBe('card XXXX XXXX 01²⁴');
  });

  it('never masks a phone number after a + (M6), however it is written', () => {
    for (const phone of [
      '+91 141 2345678',
      '+91 22 2345 6789',
      '+911412345678',
      '+919876543210',
      '+971 50 123 4567',
      '+966 55 123 4567',
      '+44 7911 123456',
      '+44 20 7946 0958',
      '+971501234567',
      '+1 415 555 2671',
    ]) {
      expect(maskIdentityText(`call ${phone}`), phone).toBe(`call ${phone}`);
      expect(
        findPersonalNumbers(phone).map((n) => n.kind),
        phone,
      ).toEqual(['phone']);
      expect(digitsLeft(redactText(phone)).endsWith(digitsLeft(phone).slice(-4)), phone).toBe(true);
    }
    // An Aadhaar number never carries a country code: grouped as one after a +, it is masked.
    for (const text of ['Aadhaar +2345-6789-0124', 'Ram + 2345 6789 0124', '+91-234567890124']) {
      expect(digitsLeft(maskIdentityText(text)), text).not.toContain('23456789');
    }
  });
});
