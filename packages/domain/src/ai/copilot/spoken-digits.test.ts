import { describe, expect, it } from 'vitest';
import { maskWholeText } from '../../knowledge/passages';
import { spokenDigitsAsFigures } from './spoken-digits';

// A number said digit by digit in a call is masked whole once the transcript is masked
// (`summariseCall()`: these figures first, then `maskWholeText()`).

/** A valid Aadhaar number (its Verhoeff check digit is 4), and the same said aloud. */
const AADHAAR = '234567890124';
const HINDI = 'do teen char paanch, chhe saat aath nau, shunya ek do char';
const ENGLISH = 'two three four five six seven eight nine zero one two four';

const masked = (text: string) => maskWholeText(spokenDigitsAsFigures(text));

describe('spokenDigitsAsFigures', () => {
  it('writes a number said in Hindi or English digit words as figures', () => {
    expect(spokenDigitsAsFigures(`Mera Aadhaar ${HINDI} hai.`)).toBe(
      `Mera Aadhaar ${AADHAAR} hai.`,
    );
    expect(spokenDigitsAsFigures(`It is ${ENGLISH}.`)).toBe(`It is ${AADHAAR}.`);
  });

  it('reads double and triple, and figures mixed with words', () => {
    expect(spokenDigitsAsFigures('nine eight double seven, six triple zero one two')).toBe(
      '9877600012',
    );
    expect(spokenDigitsAsFigures('2345 chhe saat aath nau 0124')).toBe(AADHAAR);
  });

  it('leaves ordinary words and short runs alone', () => {
    const plain = 'Do din mein ek baar call kariye, 5 HP ka pump, 120 feet ka bore.';
    expect(spokenDigitsAsFigures(plain)).toBe(plain);
    expect(spokenDigitsAsFigures('ek do teen')).toBe('ek do teen');
    expect(spokenDigitsAsFigures('9812 345 678')).toBe('9812 345 678');
  });

  it('lets the masking catch an identity number or a phone number said aloud', () => {
    for (const said of [HINDI, ENGLISH]) {
      const out = masked(`Aadhaar number ${said} hai.`);
      expect(out).not.toContain(AADHAAR);
      expect(out).toContain('[number]');
      // Without the figures, the masking finds nothing in the words.
      expect(maskWholeText(`Aadhaar number ${said} hai.`)).toContain(said);
    }
    expect(masked('Mera number nau aath ek do teen, char paanch chhe saat aath hai.')).toContain(
      '[phone]',
    );
  });
});
