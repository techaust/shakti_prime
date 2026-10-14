import { redactText } from '../ports/redaction';
import {
  asciiDigits,
  DIGIT_RUN,
  isPhone,
  normalise,
  pass,
  SEP,
  setAsideIds,
  setAsideSafeShapes,
  whole,
  type Span,
} from './number-shapes';

export { asciiDigits } from './number-shapes';

// Text on its way to a language model (SECURITY §5 and §6, AGENTS §9). Personal data is replaced
// by placeholders, never kept in part, by one method rather than a pattern per spelling:
//
// 1. The text is read in a normalised form, for finding things only: invisible characters
//    (format and other default-ignorable characters, the blank Braille pattern, no-break spaces)
//    dropped; every decimal digit of any script as an ASCII digit; every other space, tab, line
//    break and Unicode dash or minus as one space; full-width letters and signs, and superscript
//    and subscript digits, as ASCII. Each normalised position maps back
//    to the original, so a placeholder replaces exactly the original characters. Steps 1, 3 and
//    the digit runs of 4 are shared with the log and audit scrubber (`./number-shapes`).
// 2. UUIDs, then email and UPI addresses, GSTIN and PAN (with or without spaces or hyphens between
//    their groups) are found first.
// 3. Shapes known to be safe are set aside next, but only when they stand alone (no digit joined
//    to them by a separator): dates, times, timestamps with their offset, ranges of them, rupee
//    amounts after ₹, Rs, INR or an amount word, quantities with their unit, and product codes.
// 4. Then any run of digit groups joined by at most three separators (`SEP`: space . , / _ - :
//    brackets, quotes, bars, stars, hashes, tildes, plus and equals signs, middle dots, bullets and
//    backslashes), digits touching letters included, holding nine or more digits becomes `[phone]`
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

// Step 2: shapes that are personal data whatever surrounds them.
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

// Step 4: runs of nine digits or more.
const MASKED_DIGITS = 9;

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
  let work = setAsideIds(text, spans);
  work = pass(work, spans, EMAIL, whole('[email]'));
  work = pass(work, spans, UPI, whole('[upi]'));
  work = pass(work, spans, GSTIN, whole('[gstin]'));
  work = pass(work, spans, PAN, whole('[pan]'));
  work = setAsideSafeShapes(work, spans);
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
