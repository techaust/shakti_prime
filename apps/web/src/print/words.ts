// A rupee amount in words, Indian style (crore, lakh, thousand), as a quotation prints it beside
// its total. The words come from the message catalogue (`print.words`), like every printed word.
import type { PrintCopy } from './copy';

/** Under a hundred, in words; `n` is 1 to 99. */
function belowHundred(n: number, t: PrintCopy): string {
  if (n < 20) return t(`words.units.${String(n)}` as 'words.units.1');
  const tens = t(`words.tens.${String(Math.floor(n / 10))}` as 'words.tens.2');
  const rest = n % 10;
  return rest === 0 ? tens : `${tens} ${t(`words.units.${String(rest)}` as 'words.units.1')}`;
}

/** Under a thousand, in words; `n` is 1 to 999. */
function belowThousand(n: number, t: PrintCopy): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(t('words.hundred', { n: belowHundred(hundreds, t) }));
  if (rest > 0) parts.push(belowHundred(rest, t));
  return parts.join(' ');
}

/** A whole number above zero in words, Indian style; crores of crores read as "… Crore". */
function inWords(n: number, t: PrintCopy): string {
  const crore = Math.floor(n / 10_000_000);
  let rest = n % 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  const parts: string[] = [];
  if (crore > 0) parts.push(t('words.crore', { n: inWords(crore, t) }));
  if (lakh > 0) parts.push(t('words.lakh', { n: belowHundred(lakh, t) }));
  if (thousand > 0) parts.push(t('words.thousand', { n: belowHundred(thousand, t) }));
  if (rest > 0) parts.push(belowThousand(rest, t));
  return parts.join(' ');
}

/**
 * Whole rupees of a money string (`"68209.00"`) in words: "Rupees Sixty Eight Thousand Two
 * Hundred Nine only". The total of a quotation is always whole rupees (ADR 0007); paise, if any,
 * are left out.
 */
export function rupeesInWords(amount: string, t: PrintCopy): string {
  const match = /^(\d{1,12})(?:\.\d{2})?$/.exec(amount);
  if (!match) throw new RangeError('amount is not a money string');
  const rupees = Number(match[1]);
  return t('words.rupees', { words: rupees === 0 ? t('words.zero') : inWords(rupees, t) });
}
