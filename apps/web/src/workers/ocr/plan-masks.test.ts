import { verhoeffCheckDigit } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { planMasks, scrubHiddenDigits, type OcrLine, type OcrWord } from './plan-masks';

// Made-up numbers only, built with a correct check digit in the test.
const body = '59037775078';
const number = body + verhoeffCheckDigit(body);

const CHAR = 20;
const TOP = 100;
const HEIGHT = 30;

/** Words laid out left to right, each character CHAR wide, one space between words. */
function line(...texts: string[]): OcrLine {
  let x = 0;
  const words: OcrWord[] = texts.map((text) => {
    const symbols = Array.from(text, (c, i) => ({
      text: c,
      bbox: { x0: x + i * CHAR, y0: TOP, x1: x + (i + 1) * CHAR, y1: TOP + HEIGHT },
    }));
    const word = {
      text,
      bbox: { x0: x, y0: TOP, x1: x + text.length * CHAR, y1: TOP + HEIGHT },
      symbols,
    };
    x += (text.length + 1) * CHAR;
    return word;
  });
  return { words };
}

describe('planMasks', () => {
  it('covers the first two groups of a spaced number and leaves the last group readable', () => {
    const plan = planMasks([
      line('Aadhaar', 'No:', number.slice(0, 4), number.slice(4, 8), number.slice(8)),
    ]);
    expect(plan.masked.text).toBe(`Aadhaar No: XXXX XXXX ${number.slice(8)}`);
    expect(plan.masked.aadhaarLastFour).toEqual([number.slice(8)]);
    expect(plan.rects).toHaveLength(2);
    const lastGroupStart = (7 + 1 + 3 + 1 + 4 + 1 + 4 + 1) * CHAR;
    for (const rect of plan.rects) {
      expect(rect.x1).toBeLessThan(lastGroupStart);
      expect(rect.y0).toBeLessThan(TOP);
      expect(rect.y1).toBeGreaterThan(TOP + HEIGHT);
    }
    expect(plan.hiddenDigits).toEqual([number.slice(0, 8)]);
  });

  it('covers only the first eight characters of an unspaced number', () => {
    const plan = planMasks([line('UID', number)]);
    expect(plan.rects).toHaveLength(1);
    const [rect] = plan.rects;
    const wordStart = 4 * CHAR;
    expect(rect?.x0).toBeLessThan(wordStart);
    expect(rect?.x1).toBeGreaterThan(wordStart + 8 * CHAR);
    expect(rect?.x1).toBeLessThan(wordStart + 9 * CHAR);
    expect(plan.masked.text).toBe(`UID XXXXXXXX${number.slice(8)}`);
  });

  it('uses the previous line for an account label', () => {
    const plan = planMasks([line('Account', 'Number'), line('50100234871936')]);
    expect(plan.masked.text).toBe('Account Number\nXXXXXXXXXX1936');
    expect(plan.masked.bankAccountLastFour).toEqual(['1936']);
    expect(plan.rects).toHaveLength(1);
  });

  it('covers nothing on a page without such numbers', () => {
    const plan = planMasks([line('Consumer', 'No:', '482917360055'), line('Mobile', '9829041736')]);
    expect(plan.rects).toEqual([]);
    expect(plan.masked.text).toBe('Consumer No: 482917360055\nMobile 9829041736');
  });
});

describe('scrubHiddenDigits', () => {
  it('hides words made of digits another reading found to be hidden', () => {
    const hidden = [number.slice(0, 8)];
    // The first group as a blurred photo reads it, with the letter O for its zero.
    expect(number.charAt(2)).toBe('0');
    const text = `Aadhaar ${number.slice(0, 2)}O${number.slice(3, 4)} ${number.slice(4, 8)} ${number.slice(8)}`;
    expect(scrubHiddenDigits(text, hidden)).toBe(`Aadhaar XXXX XXXX ${number.slice(8)}`);
  });

  it('leaves the text alone when nothing was hidden', () => {
    expect(scrubHiddenDigits('Bill 1234 5678', [])).toBe('Bill 1234 5678');
  });
});
