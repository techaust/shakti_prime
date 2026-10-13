// How personal numbers are found in text, shared by the model masker (`maskForModel()`), the log
// and audit scrubber (`redactText()`) and the import's identity-number filter, so the three read a
// number the same way and can never drift apart again (audit SEC-3, 12-10-2026). No Node API: the
// scrubber runs in the edge runtime and the browser's error reporting too.
//
// 1. The text is read in a normalised form, for finding things only: every decimal digit of any
//    script as an ASCII digit; every space, tab, line break, format character and Unicode dash or
//    minus as one space; full-width letters and signs as ASCII. Each normalised position maps back
//    to the original, so a replacement covers exactly the original characters.
// 2. UUIDs and the shapes known to be safe are set aside when they stand alone (no digit joined to
//    them by a separator): dates, times, timestamps with their offset, ranges of them, rupee
//    amounts after ₹, Rs, INR or an amount word, quantities with their unit, and product codes.
// 3. A run of digit groups joined by at most three separators (space . , / _ - : and brackets),
//    digits touching letters included, is what remains to judge.

const DECIMAL_DIGIT = /^\p{Nd}$/u;
const digitValues = new Map<number, number>();

/**
 * The value of a decimal digit of any script. Unicode keeps each script's digits as ten
 * consecutive code points from zero, so the value is the distance from the start of the run.
 */
function digitValue(point: number): number {
  const known = digitValues.get(point);
  if (known !== undefined) return known;
  let start = point;
  while (start > 0 && point - start < 60 && DECIMAL_DIGIT.test(String.fromCodePoint(start - 1)))
    start -= 1;
  const value = (point - start) % 10;
  digitValues.set(point, value);
  return value;
}

/** `text` with every decimal digit of any script written as an ASCII digit. */
export function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (c) =>
    /[0-9]/.test(c) ? c : String(digitValue(c.codePointAt(0) ?? 0x30)),
  );
}

/** Characters read as a space: every space, tab, line break, format character, dash and minus. */
const SPACE_LIKE = /^[\p{Zs}\p{Cf}\s‐-―−]$/u;

export interface Normalised {
  text: string;
  /** For each code unit of `text`, where its character starts and ends in the original. */
  starts: number[];
  ends: number[];
}

/** The text as the finders read it, with the map back to the original (step 1). */
export function normalise(original: string): Normalised {
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < original.length) {
    const point = original.codePointAt(i) ?? 0;
    const width = point > 0xffff ? 2 : 1;
    const char = String.fromCodePoint(point);
    let read: string;
    if (point < 0x80) read = /\s/.test(char) ? ' ' : char;
    else if (SPACE_LIKE.test(char)) read = ' ';
    else if (DECIMAL_DIGIT.test(char)) read = String(digitValue(point));
    else {
      const compatible = char.normalize('NFKC');
      read = compatible.length === 1 && compatible.charCodeAt(0) < 0x80 ? compatible : char;
    }
    if (read === ' ' && out.at(-1) === ' ') {
      // A run of spaces reads as one.
      ends[ends.length - 1] = i + width;
    } else {
      for (let u = 0; u < read.length; u++) {
        out.push(read.charAt(u));
        starts.push(i);
        ends.push(i + width);
      }
    }
    i += width;
  }
  return { text: out.join(''), starts, ends };
}

/** A stretch of the normalised text: masked by a placeholder, or (null) kept as safe. */
export interface Span {
  start: number;
  end: number;
  placeholder: string | null;
}

/** What stands in for a stretch already taken: no pattern reads it as anything. */
const TAKEN = '\u0001';

/**
 * Runs one pattern over the text not yet taken, records the stretches `decide` keeps or masks, and
 * returns the text with them taken.
 */
export function pass(
  work: string,
  spans: Span[],
  pattern: RegExp,
  decide: (match: RegExpExecArray) => Span | null,
): string {
  const found: Span[] = [];
  for (const match of work.matchAll(pattern)) {
    const span = decide(match);
    if (span !== null && span.end > span.start) found.push(span);
  }
  return take(work, spans, found);
}

/** Records `found` (in order, not overlapping) and answers the text with them taken. */
function take(work: string, spans: Span[], found: readonly Span[]): string {
  if (found.length === 0) return work;
  spans.push(...found);
  let out = '';
  let at = 0;
  for (const span of found) {
    out += work.slice(at, span.start) + TAKEN.repeat(span.end - span.start);
    at = span.end;
  }
  return out + work.slice(at);
}

/** The whole match as one stretch. */
export const whole =
  (placeholder: string | null) =>
  (match: RegExpExecArray): Span => ({
    start: match.index,
    end: match.index + match[0].length,
    placeholder,
  });

/** What may join the groups of a number as people write it. */
export const SEP = '[ .,/_:()-]';
/** Nothing joined on the left: no letter or digit touching it, no digit a separator away. */
export const ALONE_BEFORE = `(?<![\\p{L}\\p{N}_]|\\d${SEP}{1,3})`;
/** Nothing joined on the right. */
export const ALONE_AFTER = `(?![\\p{L}\\p{N}_]|${SEP}{1,3}\\d)`;

const UUID =
  /(?<![0-9a-z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-z])/gi;

/** UUIDs, whose last group may be all digits, set aside before anything else reads the text. */
export function setAsideIds(work: string, spans: Span[]): string {
  return pass(work, spans, UUID, whole(null));
}

// Step 2: shapes kept as they are when they stand alone.
const DAY = '(?:0?[1-9]|[12]\\d|3[01])';
const MONTH = '(?:0?[1-9]|1[0-2])';
const YEAR = '(?:19|20)\\d{2}';
const HOUR = '(?:[01]?\\d|2[0-3])';
const MINUTE = '[0-5]\\d';
const CLOCK = `${HOUR}:${MINUTE}(?::${MINUTE}(?:\\.\\d{1,6})?)?(?: ?(?:[+-]\\d{2}(?::?\\d{2})?|Z))?(?: ?[aApP]\\.?[mM]\\.?)?`;
const TIME = `(?:${CLOCK}|${HOUR}\\.${MINUTE})`;
const DATE = `(?:${DAY}-${MONTH}-${YEAR}|${DAY}\\.${MONTH}\\.${YEAR}|${DAY}/${MONTH}/${YEAR}|${YEAR}-${MONTH}-${DAY}|${YEAR}/${MONTH}/${DAY})`;
const DATE_TIME = `${DATE}(?:[ T]${CLOCK})?`;
const RANGE = '(?: ?- ?| | to | till | until )';
const DATES = new RegExp(
  `${ALONE_BEFORE}${DATE_TIME}(?:${RANGE}${DATE_TIME})?${ALONE_AFTER}`,
  'gu',
);
const TIMES = new RegExp(`${ALONE_BEFORE}${TIME}(?:${RANGE}${TIME})?${ALONE_AFTER}`, 'gu');
/** A rupee figure: lakh or western commas (at most eleven digits), or nine digits plain. */
const RUPEES =
  '(?:\\d{1,2}(?:,\\d{2}){1,3},\\d{3}|\\d{1,3}(?:,\\d{3}){1,2}|\\d{1,9})(?:\\.\\d{1,2})?(?: ?/-)?(?: ?(?:lakhs?|lacs?|crores?|cr))?';
const CURRENCY = '(?:₹|rs\\.?|inr|rupees?)';
const AMOUNT_WORD =
  '(?:amount|budget|costs?|quoted|price|total|paid|balance|mrp|value|emi)(?: of| is| at)?:?';
const AMOUNTS = new RegExp(
  `${ALONE_BEFORE}(?:${CURRENCY} ?|${AMOUNT_WORD} ?(?:${CURRENCY} ?)?)${RUPEES}(?: ?- ?(?:${CURRENCY} ?)?${RUPEES})?${ALONE_AFTER}`,
  'giu',
);
const QUANTITY_NUMBER = '\\d{1,6}(?:\\.\\d{1,3})?';
const UNIT =
  '(?:kwp|kwh|kw|kva|hp|mm|cm|m|ft|feet|inch(?:es)?|%|panels?|nos\\.?|litres?|liters?|v|w)';
const QUANTITIES = new RegExp(
  `${ALONE_BEFORE}${QUANTITY_NUMBER}(?: ?(?:-|to) ?${QUANTITY_NUMBER})? ?${UNIT}${ALONE_AFTER}`,
  'giu',
);
/** A product or document code (`SP-7.5-100-2026`): capitals, then short groups and a year. */
const CODES = new RegExp(
  `(?<![\\p{L}\\p{N}_-])[A-Z]{1,4}(?:-[A-Z]{1,4})*(?:-\\d{1,3}(?:\\.\\d{1,2})?)+(?:-${YEAR})?${ALONE_AFTER}`,
  'gu',
);
/** The most digits a code keeps, its year aside: a code never hides a number. */
const CODE_DIGITS = 6;

/** Sets aside the safe shapes of step 2 that stand alone, in the order they are tried. */
export function setAsideSafeShapes(work: string, spans: Span[]): string {
  let out = work;
  out = pass(out, spans, DATES, whole(null));
  out = pass(out, spans, TIMES, whole(null));
  out = pass(out, spans, AMOUNTS, whole(null));
  out = pass(out, spans, QUANTITIES, whole(null));
  out = pass(out, spans, CODES, (match) => {
    const groups = match[0].split('-').filter((g) => /\d/.test(g));
    const last = groups.at(-1) ?? '';
    const yearless = new RegExp(`^${YEAR}$`).test(last) ? groups.slice(0, -1) : groups;
    const digits = yearless.join('').replace(/\D/g, '').length;
    return digits <= CODE_DIGITS ? whole(null)(match) : null;
  });
  return out;
}

/** Step 3: a run of digit groups, with a leading `+` or bracket. */
export const DIGIT_RUN = new RegExp(`(?<![\\d+(])(?:\\+ ?|\\( ?)?\\d+(?:${SEP}{1,3}\\d+)*`, 'g');

/** Whether a run of digits reads as an Indian mobile or landline number. */
export function isPhone(raw: string, digits: string): boolean {
  if (raw.startsWith('+')) return true;
  if (digits.length === 10) return /^[6-9]/.test(digits);
  if (digits.length === 11) return digits.startsWith('0');
  if (digits.length === 12) return /^91[6-9]/.test(digits);
  if (digits.length === 13) return /^091[6-9]/.test(digits);
  return false;
}

/** A personal number found in text, by the shape it is written in. */
export interface FoundNumber {
  /**
   * `aadhaar`: twelve digits written as an Aadhaar number is (one run of twelve, or groups of
   * 4-8, 8-4 or 4-4-4); `phone`: a mobile or landline number (`isPhone`).
   */
  kind: 'aadhaar' | 'phone';
  /** Offsets into the text searched; `end` is exclusive. */
  start: number;
  end: number;
  /** The digits alone, in ASCII. Never log or store this. */
  digits: string;
  /** Written after a `+`, as an international number is. */
  plus: boolean;
  /**
   * Twelve digits in one run beginning 91 and a mobile number's first digit: an Aadhaar number's
   * shape and a mobile number's with its country code both. The scrubber hides it whole; the
   * import decides by the column and the check digit.
   */
  alsoPhone: boolean;
}

interface Group {
  start: number;
  end: number;
  digits: string;
}

const AADHAAR_GROUPINGS = new Set(['12', '4-8', '8-4', '4-4-4']);

/** The digit groups of one run of the normalised text, at their offsets in it. */
function groupsOf(run: string, at: number): Group[] {
  return [...run.matchAll(/\d+/g)].map((m) => ({
    start: at + m.index,
    end: at + m.index + m[0].length,
    digits: m[0],
  }));
}

/**
 * The Aadhaar-shaped and phone-shaped numbers of one run, Aadhaar numbers first: a phone read
 * across part of an Aadhaar number would leave the rest of it whole. Each is whole groups only, so
 * digits are never split off a group to make a number up.
 */
function numbersOfRun(run: string, at: number, out: FoundNumber[]): void {
  const groups = groupsOf(run, at);
  const plus = run.startsWith('+');
  const claimed = new Array<boolean>(groups.length).fill(false);
  const found: { from: number; to: number; kind: 'aadhaar' | 'phone' }[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (plus && i === 0) continue;
    for (const size of [3, 2, 1]) {
      const window = groups.slice(i, i + size);
      if (window.length < size) continue;
      if (!AADHAAR_GROUPINGS.has(window.map((g) => g.digits.length).join('-'))) continue;
      found.push({ from: i, to: i + size - 1, kind: 'aadhaar' });
      for (let k = i; k < i + size; k++) claimed[k] = true;
      i += size - 1;
      break;
    }
  }
  for (let i = 0; i < groups.length; i++) {
    if (claimed[i] === true) continue;
    for (let size = Math.min(5, groups.length - i); size >= 1; size--) {
      const window = groups.slice(i, i + size);
      if (window.some((_, k) => claimed[i + k] === true)) continue;
      const digits = window.map((g) => g.digits).join('');
      const withPlus = plus && i === 0;
      const phone = withPlus ? digits.length >= 8 && digits.length <= 15 : isPhone('', digits);
      if (!phone) continue;
      found.push({ from: i, to: i + size - 1, kind: 'phone' });
      for (let k = i; k < i + size; k++) claimed[k] = true;
      i += size - 1;
      break;
    }
  }
  for (const f of found) {
    const first = groups[f.from];
    const last = groups[f.to];
    if (first === undefined || last === undefined) continue;
    const digits = groups
      .slice(f.from, f.to + 1)
      .map((g) => g.digits)
      .join('');
    const fromRunStart = f.from === 0;
    out.push({
      kind: f.kind,
      // A leading `+` or bracket goes with the number it opens.
      start: fromRunStart ? at : first.start,
      end: last.end,
      digits,
      plus: fromRunStart && plus,
      alsoPhone: f.kind === 'aadhaar' && f.from === f.to && /^91[6-9]/.test(digits),
    });
  }
}

/** Quick test: a text without a digit of any script holds no number. */
const ANY_DIGIT = /\p{Nd}/u;

/**
 * Every Aadhaar-shaped and phone-shaped number in `text`, in order, at its offsets in `text`:
 * written in any script's digits, joined by spaces, dots, commas, slashes, underscores, hyphens,
 * colons or brackets, touching letters or not. UUIDs, dates, times, amounts, quantities and
 * product codes standing alone are passed over, as `maskForModel()` passes them over.
 */
export function findPersonalNumbers(text: string): FoundNumber[] {
  if (!ANY_DIGIT.test(text)) return [];
  const { text: read, starts, ends } = normalise(text);
  const spans: Span[] = [];
  let work = setAsideIds(read, spans);
  work = setAsideSafeShapes(work, spans);
  const found: FoundNumber[] = [];
  for (const match of work.matchAll(DIGIT_RUN)) numbersOfRun(match[0], match.index, found);
  return found
    .map((n) => ({
      ...n,
      start: starts[n.start] ?? 0,
      end: ends[n.end - 1] ?? text.length,
    }))
    .sort((a, b) => a.start - b.start);
}

/** `text` with each found number replaced by what `render` makes of it. */
export function replaceNumbers(
  text: string,
  found: readonly FoundNumber[],
  render: (n: FoundNumber, original: string) => string,
): string {
  let out = '';
  let at = 0;
  for (const n of found) {
    if (n.start < at) continue;
    out += text.slice(at, n.start) + render(n, text.slice(n.start, n.end));
    at = n.end;
  }
  return out + text.slice(at);
}
