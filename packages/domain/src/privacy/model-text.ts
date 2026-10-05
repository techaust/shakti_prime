import { redactText } from '../ports/redaction';

// Text on its way to a language model (SECURITY §5 and §6, AGENTS §9). Personal data is replaced
// by placeholders, never kept in part: a phone number becomes `[phone]`; any other run of nine or
// more digits (an Aadhaar or bank account number, however it is spaced, dotted or hyphenated, and
// in Devanagari or other Indian digits) becomes `[number]`; email and UPI addresses, PAN and GSTIN
// become `[email]`, `[upi]`, `[pan]` and `[gstin]`. Street addresses are masked on a best-effort
// heuristic only (SECURITY §6, a known limitation): a house, flat, plot or similar number after
// its label becomes `[address]`, and a PIN code after its label or a place name becomes `[pin]`.
// Callers still send only the fields a run needs.

/** The zero of each Indian script's digits, the Arabic-Indic ones and the full-width ones. */
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10,
];

/** `text` with every decimal digit of any script written as an ASCII digit. */
export function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (c) => {
    if (/[0-9]/.test(c)) return c;
    const point = c.codePointAt(0) ?? 0x30;
    const zero = DIGIT_ZEROS.find((z) => point >= z && point <= z + 9);
    // A digit of another script still counts as a digit; which one does not matter for masking.
    return zero === undefined ? '0' : String(point - zero);
  });
}

/** A UUID, which may hold long runs of digits and is never personal data: kept as it is. */
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** What may join the groups of a number as people write it: spaces, dots, hyphens, brackets. */
const SEP = '[ \\t.()\\u2010-\\u2015-]{1,3}';

/** Digits in groups, standing alone: no word character, and no joined digit, on either side. */
const DIGIT_RUN = new RegExp(`(?<!\\w|\\d${SEP})\\(?\\+?\\d+(?:${SEP}\\d+)*(?!\\w|${SEP}\\d)`, 'g');

/** Whether a run of digits reads as an Indian mobile or landline number. */
function isPhone(raw: string, digits: string): boolean {
  if (raw.startsWith('+')) return true;
  if (digits.length === 10) return /^[6-9]/.test(digits);
  if (digits.length === 11) return digits.startsWith('0');
  if (digits.length === 12) return /^91[6-9]/.test(digits);
  if (digits.length === 13) return /^091[6-9]/.test(digits);
  return false;
}

/** A label before a house, flat, plot or similar number, then the number itself. */
const HOUSE_NUMBER =
  /\b(?:h(?:ouse)?\.?\s?no|flat(?:\s?no)?|plot(?:\s?no)?|door\s?no|khasra(?:\s?no)?|ward(?:\s?no)?|gali(?:\s?no)?|street\s?no|sector|block|quarter\s?no|shop\s?no)\b\.?\s*[:#-]?\s*[\w/-]*\d[\w/-]*/gi;

/** A hash and a number, as `#12` is written in an address. */
const HASH_NUMBER = /(?<![\w&])#\s?\d[\w/-]*/g;

/** A PIN code after its label. */
const LABELLED_PIN = /\b(?:pin(?:\s?code)?|postal\s?code)\b\.?\s*[:#-]?\s*[1-9]\d{2}\s?\d{3}\b/gi;

/** Six digits after a word (`Jaipur 302001`, `Rajasthan - 302 001`); kept after a currency. */
const PLACE_PIN = /\b([A-Za-z]{2,}\.?,?\s?-?\s?)([1-8]\d{2}\s?\d{3})(?![\w.,]?\d|\s?%)/g;
const NOT_A_PLACE = /^(?:rs|inr|rupees?|paise|amount|total|price|cost|mrp|qty|no|number)\b/i;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const UPI = /(?<![\w.+-])[\w.-]{2,256}@[a-z]{2,64}(?![\w.@-])/gi;
const GSTIN = /\b\d{2}[a-z]{5}\d{4}[a-z][a-z\d]z[a-z\d]\b/gi;
const PAN = /\b[a-z]{3}[abcfghljpt][a-z]\d{4}[a-z]\b/gi;

function maskSegment(segment: string): string {
  return segment
    .replace(EMAIL, '[email]')
    .replace(UPI, '[upi]')
    .replace(GSTIN, '[gstin]')
    .replace(PAN, '[pan]')
    .replace(HOUSE_NUMBER, '[address]')
    .replace(HASH_NUMBER, '[address]')
    .replace(LABELLED_PIN, '[pin]')
    .replace(DIGIT_RUN, (raw) => {
      const digits = raw.replace(/\D/g, '');
      if (digits.length < 9) return raw;
      return isPhone(raw, digits) ? '[phone]' : '[number]';
    })
    .replace(PLACE_PIN, (whole, word: string) => (NOT_A_PLACE.test(word) ? whole : `${word}[pin]`));
}

/** `text` as a model may read it. */
export function maskForModel(text: string): string {
  const masked = asciiDigits(text)
    .split(UUID)
    .map((part, i) => (i % 2 === 1 ? part : maskSegment(part)))
    .join('');
  // Links, keys and passwords pasted into text, scrubbed as the logs scrub them.
  return redactText(masked);
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
