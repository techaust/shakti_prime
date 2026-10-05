import { describe, expect, it } from 'vitest';
import { printCopy } from './copy';
import { rupeesInWords } from './words';

describe('rupeesInWords', () => {
  const t = printCopy();
  it.each([
    ['0.00', 'Rupees Zero only'],
    ['7.00', 'Rupees Seven only'],
    ['19.00', 'Rupees Nineteen only'],
    ['20.00', 'Rupees Twenty only'],
    ['99.00', 'Rupees Ninety Nine only'],
    ['100.00', 'Rupees One Hundred only'],
    ['101.00', 'Rupees One Hundred One only'],
    ['68209.00', 'Rupees Sixty Eight Thousand Two Hundred Nine only'],
    ['100000.00', 'Rupees One Lakh only'],
    ['1250000.00', 'Rupees Twelve Lakh Fifty Thousand only'],
    ['10000000.00', 'Rupees One Crore only'],
    [
      '123456789.00',
      'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine only',
    ],
    [
      '999999999999.00',
      'Rupees Ninety Nine Thousand Nine Hundred Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine only',
    ],
  ])('%s', (amount, words) => {
    expect(rupeesInWords(amount, t)).toBe(words);
  });

  it('refuses what is not a money string', () => {
    expect(() => rupeesInWords('12.5', t)).toThrow(RangeError);
  });
});
