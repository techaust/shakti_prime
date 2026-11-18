// Verhoeff check digit, the checksum UIDAI uses for the last digit of an Aadhaar number.
// It catches every single-digit error and every swap of two neighbouring digits, which is
// what lets the OCR masking step tell a real Aadhaar number from any other 12-digit run.

const MULTIPLY: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const PERMUTE: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INVERSE: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

const DIGITS = /^\d+$/;

function checksum(digits: string, offset: number): number {
  let c = 0;
  const n = digits.length;
  for (let i = 0; i < n; i++) {
    const digit = digits.charCodeAt(n - 1 - i) - 48;
    // The tables are 10 and 8 rows of 10 entries and every index is reduced into range.
    c = MULTIPLY[c]?.[PERMUTE[(i + offset) % 8]?.[digit] ?? 0] ?? 0;
  }
  return c;
}

/** True when the last digit of `digits` is the Verhoeff check digit of the others. */
export function verhoeffValid(digits: string): boolean {
  if (!DIGITS.test(digits)) return false;
  return checksum(digits, 0) === 0;
}

/** The Verhoeff check digit to append to `digits`. */
export function verhoeffCheckDigit(digits: string): string {
  if (!DIGITS.test(digits)) throw new RangeError('digits only');
  return String(INVERSE[checksum(digits, 1)]);
}
