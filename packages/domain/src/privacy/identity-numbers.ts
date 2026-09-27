// Finds and masks Aadhaar and bank account numbers in text (BLUEPRINT §7.5, SECURITY.md §5).
// The OCR masking worker runs this over the text it reads from a document photo and uses the
// spans to decide which parts of the image to cover. Only the last four digits survive.
import { verhoeffValid } from './verhoeff';

export type IdentityNumberKind =
  /** Twelve digits, first digit 2 to 9, Verhoeff check digit correct. */
  | 'aadhaar'
  /**
   * Printed in the Aadhaar layout (three groups of four) but not a valid number, usually
   * because the camera or the OCR changed one digit. Masked all the same: a misread digit must
   * never leave the other eleven readable.
   */
  | 'aadhaar_unverified'
  /** Nine to eighteen digits next to an account label. */
  | 'bank_account';

export interface IdentityNumberSpan {
  kind: IdentityNumberKind;
  /** Offsets into the searched text; `end` is exclusive. */
  start: number;
  end: number;
  /** The digits alone, without spaces or hyphens. Never log or store this. */
  digits: string;
}

export interface MaskedText {
  text: string;
  /** Last four digits of each Aadhaar number found, in reading order. */
  aadhaarLastFour: string[];
  /** Last four digits of each bank account number found, in reading order. */
  bankAccountLastFour: string[];
  /** How many spans of each kind were masked. */
  counts: Record<IdentityNumberKind, number>;
}

/** Digits of an Aadhaar number are kept only from this index on (the last four). */
export const AADHAAR_VISIBLE_FROM = 8;

// Three groups of four, joined by nothing, one space or one hyphen, not part of a longer run
// (a sixteen-digit Virtual ID printed as four groups is left out by the boundary checks).
const AADHAAR_PATTERN = /(?<!\d[ -]?)(\d{4})([ -]?)(\d{4})\2(\d{4})(?![ -]?\d)/g;

const BANK_DIGITS = /(?<![\d-])\d{9,18}(?![\d-])/g;

// "A/c No", "A/C", "Ac No", "Account", "Acct", "Account Number", "Savings Account".
const ACCOUNT_LABEL = /(?<![A-Za-z])(a\s?\/\s?c|ac(?:\s?no)|acc(?:oun)?t|acct|account)(?![A-Za-z])/i;

/** True for twelve digits that could be a real Aadhaar number (no leading 0 or 1, checksum). */
export function isAadhaarNumber(digits: string): boolean {
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValid(digits);
}

/**
 * Every Aadhaar and bank account number in `text`, in order. `context` is text that comes just
 * before `text` (the previous line of a document), used only to find an account label.
 */
export function findIdentityNumbers(text: string, context = ''): IdentityNumberSpan[] {
  const spans: IdentityNumberSpan[] = [];
  for (const match of text.matchAll(AADHAAR_PATTERN)) {
    const digits = `${match[1] ?? ''}${match[3] ?? ''}${match[4] ?? ''}`;
    const spaced = (match[2] ?? '') !== '';
    let kind: IdentityNumberKind | undefined;
    if (isAadhaarNumber(digits)) kind = 'aadhaar';
    else if (spaced) kind = 'aadhaar_unverified';
    if (kind) spans.push({ kind, start: match.index, end: match.index + match[0].length, digits });
  }

  if (ACCOUNT_LABEL.test(text) || ACCOUNT_LABEL.test(lastLine(context))) {
    for (const match of text.matchAll(BANK_DIGITS)) {
      const start = match.index;
      const end = start + match[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ kind: 'bank_account', start, end, digits: match[0] });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

function lastLine(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.at(-1) ?? '';
}

/**
 * The indices, within `span`'s own characters, of the digits to hide: the first eight of an
 * Aadhaar number, and every digit but the last four of a bank account number.
 */
export function maskedDigitIndices(span: IdentityNumberSpan, spanText: string): number[] {
  const digitPositions: number[] = [];
  for (let i = 0; i < spanText.length; i++) {
    if (/\d/.test(spanText.charAt(i))) digitPositions.push(i);
  }
  const keep = 4;
  const hide =
    span.kind === 'bank_account'
      ? Math.max(0, digitPositions.length - keep)
      : Math.min(AADHAAR_VISIBLE_FROM, digitPositions.length - keep);
  return digitPositions.slice(0, hide);
}

/** `text` with the hidden digits of every Aadhaar and bank account number replaced by X. */
export function maskIdentityNumbers(text: string): MaskedText {
  const lines = text.split('\n');
  const aadhaarLastFour: string[] = [];
  const bankAccountLastFour: string[] = [];
  const counts: Record<IdentityNumberKind, number> = {
    aadhaar: 0,
    aadhaar_unverified: 0,
    bank_account: 0,
  };
  const out = lines.map((line, i) => {
    const spans = findIdentityNumbers(line, i > 0 ? (lines[i - 1] ?? '') : '');
    if (spans.length === 0) return line;
    const chars = line.split('');
    for (const span of spans) {
      counts[span.kind] += 1;
      const lastFour = span.digits.slice(-4);
      if (span.kind === 'bank_account') bankAccountLastFour.push(lastFour);
      else aadhaarLastFour.push(lastFour);
      for (const index of maskedDigitIndices(span, line.slice(span.start, span.end))) {
        chars[span.start + index] = 'X';
      }
    }
    return chars.join('');
  });
  return { text: out.join('\n'), aadhaarLastFour, bankAccountLastFour, counts };
}
