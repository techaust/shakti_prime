import { redactText } from '../ports/redaction';

// Text on its way to a language model (SECURITY §5 and §6, AGENTS §9). Personal data is replaced
// by placeholders, never kept in part, by one method rather than a pattern per spelling:
//
// 1. The text is read in a normalised form, for finding things only: every decimal digit of any
//    script as an ASCII digit; every space, tab, line break, format character and Unicode dash or
//    minus as one space; full-width letters and signs as ASCII. Each normalised position maps back
//    to the original, so a placeholder replaces exactly the original characters.
// 2. UUIDs, then email and UPI addresses, GSTIN and PAN (with or without spaces or hyphens between
//    their groups) are found first.
// 3. Shapes known to be safe are set aside next, but only when they stand alone (no digit joined
//    to them by a separator): dates, times, timestamps with their offset, ranges of them, rupee
//    amounts after ₹, Rs, INR or an amount word, quantities with their unit, and product codes.
// 4. Then any run of digit groups joined by at most three separators (space . , / _ - : and
//    brackets), digits touching letters included, holding nine or more digits becomes `[phone]`
//    (a mobile or landline shape) or `[number]` (an Aadhaar, bank account or any other number).
// 5. Addresses on a best-effort heuristic (SECURITY §6, a known limitation): a house, plot, flat,
//    khasra, ward or gali number after its label becomes `[address]`, and a PIN code after its
//    label or after a capitalised place name becomes `[pin]`.
//
// Texts longer than `MODEL_TEXT_LIMIT` are cut first, so no pattern runs on unbounded input.
// Callers still send only the fields a run needs.

/** The longest text masked and sent; the rest is cut off with a marker. */
export const MODEL_TEXT_LIMIT = 20_000;
const TRUNCATED = ' [truncated]';

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

interface Normalised {
  text: string;
  /** For each code unit of `text`, where its character starts and ends in the original. */
  starts: number[];
  ends: number[];
}

/** The text as the masks read it, with the map back to the original (step 1). */
function normalise(original: string): Normalised {
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
interface Span {
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
function pass(
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
const whole =
  (placeholder: string | null) =>
  (match: RegExpExecArray): Span => ({
    start: match.index,
    end: match.index + match[0].length,
    placeholder,
  });

// What may join the groups of a number as people write it.
const SEP = '[ .,/_:()-]';
/** Nothing joined on the left: no letter or digit touching it, no digit a separator away. */
const ALONE_BEFORE = `(?<![\\p{L}\\p{N}_]|\\d${SEP}{1,3})`;
/** Nothing joined on the right. */
const ALONE_AFTER = `(?![\\p{L}\\p{N}_]|${SEP}{1,3}\\d)`;

// Step 2: shapes that are personal data whatever surrounds them.
const UUID =
  /(?<![0-9a-z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-z])/gi;
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** A UPI address; a sentence's full stop after it still ends it. */
const UPI = /(?<![\w.+-])[\w.-]{2,256}@[a-z][a-z-]{1,63}(?![\w@-]|\.[a-z])/gi;
const G = '[ -]?';
const PAN_BODY = `[a-z]{3}[abcfghljpt][a-z]${G}\\d{4}${G}[a-z]`;
const GSTIN = new RegExp(
  `(?<![\\p{L}\\p{N}])\\d{2}${G}${PAN_BODY}${G}[1-9a-z]${G}z${G}[\\da-z](?![\\p{L}\\p{N}])`,
  'giu',
);
const PAN = new RegExp(`(?<![\\p{L}\\p{N}])${PAN_BODY}(?![\\p{L}\\p{N}])`, 'giu');

// Step 3: shapes kept as they are when they stand alone.
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

// Step 4: runs of digits.
const DIGIT_RUN = new RegExp(`(?<![\\d+(])(?:\\+ ?|\\( ?)?\\d+(?:${SEP}{1,3}\\d+)*`, 'g');
const MASKED_DIGITS = 9;

/** Whether a run of digits reads as an Indian mobile or landline number. */
function isPhone(raw: string, digits: string): boolean {
  if (raw.startsWith('+')) return true;
  if (digits.length === 10) return /^[6-9]/.test(digits);
  if (digits.length === 11) return digits.startsWith('0');
  if (digits.length === 12) return /^91[6-9]/.test(digits);
  if (digits.length === 13) return /^091[6-9]/.test(digits);
  return false;
}

// Step 5: addresses, after their labels only.
const HOUSE_NUMBER = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:(?:house|h|door|shop|quarter|qtr)\\.? ?(?:no|number)\\.?|(?:plot|flat|khasra|ward|gali)(?:\\.? ?(?:no|number)\\.?)?) ?[:#-]? ?[\\p{L}\\p{N}/-]*\\d[\\p{L}\\p{N}/-]*`,
  'giu',
);
const LABELLED_PIN = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:pin ?code|pin|postal ?code)\\.? ?[:#-]? ?[1-9]\\d{2} ?\\d{3}(?!\\p{N})`,
  'giu',
);
/** Six digits right after a capitalised place name (`Jaipur 302001`, `Rajasthan - 302 001`). */
const PLACE_PIN = new RegExp(
  `(?<![\\p{L}\\p{N}_])(\\p{Lu}\\p{Ll}{2,})(,? ?-? ?)([1-8]\\d{2} ?\\d{3})(?![\\p{L}\\p{N}_]|[.,]\\d|${SEP}{1,3}\\d| ?%)`,
  'gu',
);
/** Capitalised words before six digits that are not places. */
const NOT_A_PLACE = new Set([
  'about',
  'account',
  'amount',
  'approx',
  'around',
  'balance',
  'bill',
  'budget',
  'call',
  'code',
  'cost',
  'costs',
  'emi',
  'invoice',
  'lead',
  'mobile',
  'mrp',
  'number',
  'only',
  'order',
  'paid',
  'paise',
  'phone',
  'price',
  'qty',
  'quote',
  'quoted',
  'rate',
  'receipt',
  'ref',
  'rupee',
  'rupees',
  'total',
  'value',
  'year',
]);

/** The stretches of the normalised text to mask, in order (steps 2 to 5). */
function findSpans(text: string): Span[] {
  const spans: Span[] = [];
  let work = text;
  work = pass(work, spans, UUID, whole(null));
  work = pass(work, spans, EMAIL, whole('[email]'));
  work = pass(work, spans, UPI, whole('[upi]'));
  work = pass(work, spans, GSTIN, whole('[gstin]'));
  work = pass(work, spans, PAN, whole('[pan]'));
  work = pass(work, spans, DATES, whole(null));
  work = pass(work, spans, TIMES, whole(null));
  work = pass(work, spans, AMOUNTS, whole(null));
  work = pass(work, spans, QUANTITIES, whole(null));
  work = pass(work, spans, CODES, (match) => {
    const groups = match[0].split('-').filter((g) => /\d/.test(g));
    const last = groups.at(-1) ?? '';
    const yearless = new RegExp(`^${YEAR}$`).test(last) ? groups.slice(0, -1) : groups;
    const digits = yearless.join('').replace(/\D/g, '').length;
    return digits <= CODE_DIGITS ? whole(null)(match) : null;
  });
  work = pass(work, spans, HOUSE_NUMBER, whole('[address]'));
  work = pass(work, spans, LABELLED_PIN, whole('[pin]'));
  work = pass(work, spans, DIGIT_RUN, (match) => {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length < MASKED_DIGITS) return null;
    return whole(isPhone(match[0], digits) ? '[phone]' : '[number]')(match);
  });
  pass(work, spans, PLACE_PIN, (match) => {
    const [all, word = '', , pin = ''] = match;
    if (NOT_A_PLACE.has(word.toLowerCase())) return null;
    const end = match.index + all.length;
    return { start: end - pin.length, end, placeholder: '[pin]' };
  });
  return spans.sort((a, b) => a.start - b.start);
}

/** Whether a cut text may end on this character: anything that could be part of a number. */
const PART_OF_A_NUMBER = /^[\p{Nd}\p{Zs}\p{Cf}\s.,/_:()+‐-―−-]$/u;

/** `text` cut to `MODEL_TEXT_LIMIT`, with no number left half-written at the cut. */
function capped(text: string): string {
  if (text.length <= MODEL_TEXT_LIMIT) return text;
  let end = MODEL_TEXT_LIMIT;
  while (end > 0 && PART_OF_A_NUMBER.test(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end) + TRUNCATED;
}

/** `text` as a model may read it. */
export function maskForModel(text: string): string {
  const original = capped(text);
  const { text: read, starts, ends } = normalise(original);
  let out = '';
  let at = 0;
  for (const span of findSpans(read)) {
    if (span.placeholder === null) continue;
    const from = starts[span.start] ?? at;
    const to = ends[span.end - 1] ?? from;
    out += asciiDigits(original.slice(at, from)) + span.placeholder;
    at = to;
  }
  // Links, keys and passwords pasted into text, scrubbed as the logs scrub them.
  return redactText(out + asciiDigits(original.slice(at)));
}

/**
 * Data a person outside the business wrote or sent (a customer message, an upload's text, a call
 * transcript), labelled as data so a model reads it as data and never as instructions (BLUEPRINT
 * §7.8, SECURITY §6). Ampersands are escaped first, then angle brackets, so the data can neither
 * close its own label nor spell a bracket as an entity that a reader would decode.
 */
export function labelUntrusted(source: string, text: string): string {
  const safeSource = source.replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
  const escaped = maskForModel(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<untrusted_data source="${safeSource}">\n${escaped}\n</untrusted_data>`;
}
