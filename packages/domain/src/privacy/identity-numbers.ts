// Finds and masks Aadhaar and bank account numbers in text (BLUEPRINT §7.5, SECURITY.md §5).
// The OCR masking worker runs this over the text it reads from a document photo and uses the
// spans to decide which parts of the image to cover. Only the last four digits survive.
import { verhoeffValid } from './verhoeff';

export type IdentityNumberKind =
  /** Twelve digits, first digit 2 to 9, Verhoeff check digit correct. */
  | 'aadhaar'
  /**
   * Twelve digits printed in groups, as Aadhaar numbers are, but not a valid number, usually
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

// Twelve digits, any two of which may be joined by one space or one hyphen, not part of a
// longer run (a sixteen-digit Virtual ID printed as four groups is left out by the boundary
// checks). The joins are free because OCR drops spaces and splits groups in the wrong place.
const AADHAAR_PATTERN = /(?<!\d[ -]?)\d(?:[ -]?\d){11}(?![ -]?\d)/g;

// Nine to eighteen digits, joined the same way, next to an account label.
const BANK_PATTERN = /(?<!\d[ -]?)\d(?:[ -]?\d){8,17}(?![ -]?\d)/g;

// "Aadhaar" as printed and as commonly misspelt, or UID.
const AADHAAR_WORD = /aadha+r|adhaar|\buid/i;

// Letters OCR reads in place of digits. Replaced one for one, so offsets do not move.
const LOOKALIKES: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  l: '1',
  '|': '1',
  i: '1',
  Z: '2',
  z: '2',
  S: '5',
  s: '5',
  B: '8',
  G: '6',
  b: '6',
  g: '9',
};

/**
 * `text` with look-alike letters read as digits inside number-like words (at least three
 * digits and at least half digits). Same length as `text`, so offsets still line up.
 */
export function normalizeOcrDigits(text: string): string {
  return text.replace(/[^\s]+/g, (word) => {
    const digits = word.replace(/\D/g, '').length;
    if (digits < 3 || digits * 2 < word.length) return word;
    return word.replace(/[OoDQIl|iZzSsBGbg]/g, (c) => LOOKALIKES[c] ?? c);
  });
}

// "A/c No", "A/C", "Ac No", "Account", "Acct", "Account Number", "Savings Account".
const ACCOUNT_LABEL =
  /(?<![A-Za-z])(a\s?\/\s?c|ac(?:\s?no)|acc(?:oun)?t|acct|account)(?![A-Za-z])/i;

/** True for twelve digits that could be a real Aadhaar number (no leading 0 or 1, checksum). */
export function isAadhaarNumber(digits: string): boolean {
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValid(digits);
}

/**
 * Every Aadhaar and bank account number in `text`, in order. `context` is text that comes just
 * before `text` (the previous line of a document) and `labelText` the line as read, before
 * look-alike letters were corrected; both are used only to find an account label.
 */
export function findIdentityNumbers(
  text: string,
  context = '',
  labelText = text,
): IdentityNumberSpan[] {
  const spans: IdentityNumberSpan[] = [];
  const labelledHere = ACCOUNT_LABEL.test(labelText);
  // On a line labelled as an account and not as Aadhaar, a twelve-digit number is the account.
  const accountLine = labelledHere && !AADHAAR_WORD.test(labelText);
  if (!accountLine) {
    for (const match of text.matchAll(AADHAAR_PATTERN)) {
      const digits = match[0].replace(/\D/g, '');
      const spaced = digits.length !== match[0].length;
      let kind: IdentityNumberKind | undefined;
      if (isAadhaarNumber(digits)) kind = 'aadhaar';
      else if (spaced) kind = 'aadhaar_unverified';
      if (kind)
        spans.push({ kind, start: match.index, end: match.index + match[0].length, digits });
    }
  }

  if (labelledHere || ACCOUNT_LABEL.test(lastLine(context))) {
    for (const match of text.matchAll(BANK_PATTERN)) {
      const start = match.index;
      const end = start + match[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ kind: 'bank_account', start, end, digits: match[0].replace(/\D/g, '') });
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

/** Where, in one line, the digits to hide are, and what was found there. */
export interface LineMask {
  spans: IdentityNumberSpan[];
  /** Offsets into the line of every character to hide. */
  hidden: number[];
}

/**
 * The digits to hide in one line of text. `previousLine` is only read for an account label.
 * Detection runs on the look-alike-corrected copy; offsets apply to the line as given.
 */
export function maskLine(line: string, previousLine = ''): LineMask {
  const normalized = normalizeOcrDigits(line);
  const spans = findIdentityNumbers(normalized, previousLine, line);
  const hidden: number[] = [];
  for (const span of spans) {
    for (const index of maskedDigitIndices(span, normalized.slice(span.start, span.end))) {
      hidden.push(span.start + index);
    }
  }
  return { spans, hidden };
}

/** Collects the last four digits and counts of the spans found line by line. */
export function summarizeSpans(spans: IdentityNumberSpan[]): Omit<MaskedText, 'text'> {
  const counts: Record<IdentityNumberKind, number> = {
    aadhaar: 0,
    aadhaar_unverified: 0,
    bank_account: 0,
  };
  const aadhaarLastFour: string[] = [];
  const bankAccountLastFour: string[] = [];
  for (const span of spans) {
    counts[span.kind] += 1;
    const lastFour = span.digits.slice(-4);
    if (span.kind === 'bank_account') bankAccountLastFour.push(lastFour);
    else aadhaarLastFour.push(lastFour);
  }
  return { aadhaarLastFour, bankAccountLastFour, counts };
}

/** `text` with the hidden digits of every Aadhaar and bank account number replaced by X. */
export function maskIdentityNumbers(text: string): MaskedText {
  const lines = text.split('\n');
  const found: IdentityNumberSpan[] = [];
  const out = lines.map((line, i) => {
    const { spans, hidden } = maskLine(line, i > 0 ? (lines[i - 1] ?? '') : '');
    found.push(...spans);
    if (hidden.length === 0) return line;
    const chars = line.split('');
    for (const index of hidden) chars[index] = 'X';
    return chars.join('');
  });
  return { text: out.join('\n'), ...summarizeSpans(found) };
}
