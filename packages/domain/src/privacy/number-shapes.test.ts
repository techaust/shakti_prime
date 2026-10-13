import { describe, expect, it } from 'vitest';
import { redactForAudit } from '../audit/redact';
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
    expect(redactText('ids 2345 6789 0123, 9876543210 seen')).toBe('ids [number], ******3210 seen');
    expect(redactText('91 2345 6789 0123')).toBe('91 [number]');
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
