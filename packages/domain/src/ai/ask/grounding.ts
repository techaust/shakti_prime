import { ASK_ANSWER_MAX, ASK_CITED_MAX, type AskSource } from '@shakti/contracts';
import { asciiDigits } from '../../privacy/model-text';

// The grounding filter of Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5): pure,
// deterministic and closed by default, so no model decides what reaches a person. An answer may
// cite only a record a lookup returned in this conversation, and every figure in it must be one a
// lookup returned in this turn, the person wrote in their question, or today's date: of the same
// kind and the same value. Whatever fails, and whatever looks like a number but cannot be read
// with confidence, is taken out and replaced by `UNSOURCED`, which the screen says in words.
//
// Every decimal digit of any script is read as its ASCII digit first. A figure is one of:
// - a rupee amount (`inr:`): digits after ₹, Rs or INR, or before rupees, with at most one
//   magnitude word after the digits (thousand, lakh, crore, million, billion), singular and after a
//   space (`₹1,20,000`, `₹1.2 lakh`, `50,000 rupees`);
// - a percentage (`pct:`): digits before %, percent, per cent or pc;
// - a count (`n:`): digits right before a word that is not a magnitude (`23 open leads`,
//   `30 days`);
// - a date (`date:`, `month:`, `daymonth:`): a calendar day in any common form, a month and year,
//   a day and month; a lookup's date gives no bare year;
// - a document number (`doc:`): letters and digits together, compared whole, never by its parts
//   (`SS/Q/2026-27/0012`, an item code).
// Anything else number-like is never sourced: a bare number, digits with an unknown, plural,
// hyphenated or stacked magnitude word, a number word in English or Roman Hindi (`twelve`,
// `fifty lakh`, `do sau`, `hazaar`, `a dozen`, `a lakh`). A line-start number is a list's own
// numbering only in a run counting up from 1, before words that are not a magnitude.
//
// The lookups' answers are read by their fields: each money field gives an amount (the lookups
// write rupees after ₹), each rate field a percentage, each other number a count, each date a
// date, each document field its number whole; every other text is read as the answer is, with the
// records' ids taken out first, and only what it can type supplies a figure.

/** What the answer shows in place of a figure or a citation that could not be sourced. */
export const UNSOURCED = '[unsourced]';

/** A citation as the model writes it and the screen reads it. */
export const citationMarker = (id: string): string => `[ref:${id}]`;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CITATION = new RegExp(
  `\\[\\s*ref\\s*:\\s*(${UUID})\\s*\\]|(?<![0-9a-z-])(${UUID})(?![0-9a-z-])`,
  'gi',
);
/** Any id, as the lookups name records (`ref`, `lead`, `quote`). */
const ANY_UUID = new RegExp(UUID, 'gi');

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const ORDINAL = '(?:st|nd|rd|th)?';

/** The magnitude words an amount may carry, singular, and what each multiplies by. */
const KNOWN_MAGNITUDE: Readonly<Record<string, number>> = {
  thousand: 1e3,
  lakh: 1e5,
  crore: 1e7,
  million: 1e6,
  billion: 1e9,
};

/**
 * The words that say how many, in English and in Roman Hindi, in one list. A number written this
 * way is never sourced: a figure is written in digits. The Roman Hindi units that are also
 * everyday English words (`do`, `teen`, `char`) count only beside a magnitude or a rupee word,
 * "one" only before a magnitude, `score` and the short magnitudes only after a number word or "a".
 */
export const NUMBER_WORDS = {
  english: [
    'zero',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
  ],
  magnitudes: [
    'hundred',
    'hundreds',
    'thousand',
    'thousands',
    'million',
    'millions',
    'billion',
    'billions',
    'dozen',
    'dozens',
    'lakh',
    'lakhs',
    'lac',
    'lacs',
    'crore',
    'crores',
    'sau',
    'hazaar',
    'hazar',
    'hajar',
    'hazaron',
    'arab',
    'kharab',
    'shunya',
  ],
  shortMagnitudes: ['k', 'mn', 'bn', 'cr', 'grand'],
  romanHindiUnits: [
    'ek',
    'do',
    'teen',
    'char',
    'chaar',
    'paanch',
    'panch',
    'chhe',
    'chhah',
    'saat',
    'aath',
    'nau',
    'das',
    'gyarah',
    'barah',
    'terah',
    'chaudah',
    'pandrah',
    'solah',
    'satrah',
    'atharah',
    'unnis',
    'bees',
    'tees',
    'chalis',
    'chalees',
    'pachas',
    'pachaas',
    'sattar',
    'assi',
    'nabbe',
  ],
} as const;

const ENGLISH_NUMBERS = new Set<string>(NUMBER_WORDS.english);
const MAGNITUDES = new Set<string>(NUMBER_WORDS.magnitudes);
const SHORT_MAGNITUDES = new Set<string>(NUMBER_WORDS.shortMagnitudes);
const HINDI_UNITS = new Set<string>(NUMBER_WORDS.romanHindiUnits);

/**
 * The spelling families of the Indian magnitudes, beside the list: crore (karod, karor, karode,
 * kror), lakh (laakh, lak, lac, lacs, lakhs), hazaar (hajaar, hajar, hazar, hazaars, hazaron).
 */
const MAGNITUDE_FAMILIES = [
  /^k[ae]?r[oa]+[rd]e?s?$/,
  /^cror?e?s?$/,
  /^la+(?:kh|k|c)s?$/,
  /^ha[jz]{1,2}a+r(?:on|s)?$/,
];

/** A word that says how many times over: a known magnitude, its plural, a short one, any -illion. */
const isMagnitudeLike = (word: string): boolean => {
  const w = word.toLowerCase();
  return (
    MAGNITUDES.has(w) ||
    SHORT_MAGNITUDES.has(w) ||
    MAGNITUDE_FAMILIES.some((f) => f.test(w)) ||
    /illions?$/.test(w) ||
    /^scores?$/.test(w)
  );
};
/** The rupee words, every common spelling. */
const RUPEE_WORDS = 'rupees?|rupaye|rupay|rupiya|rupiye|rupaiya|rupaiye|rupaye|rs|inr';
const RUPEE_WORD = new RegExp(`^(?:${RUPEE_WORDS})$`, 'i');
/** The percent words, and percentage points, a kind of their own no lookup gives. */
const PERCENT_AFTER = /^\s*(%|percent\b|per cent\b|pct\b|pc\b)/i;
const POINTS_AFTER = /^\s*percentage\s+points?\b/i;

/**
 * The words that may stand right after an amount: punctuation or none, or one of these ordinary
 * words. Any other word after an amount (an unknown magnitude, a unit) leaves it unsourced.
 */
const AFTER_AMOUNT = new Set([
  'a',
  'an',
  'the',
  'for',
  'per',
  'of',
  'in',
  'on',
  'and',
  'or',
  'to',
  'from',
  'with',
  'each',
  'total',
  'only',
  'is',
  'was',
  'are',
  'were',
  'has',
  'had',
  'will',
  'by',
  'this',
  'that',
  'these',
  'those',
  'at',
  'as',
  'than',
  'which',
  'plus',
  'so',
  'but',
  'against',
  'since',
  'until',
  'after',
  'before',
  'over',
  'under',
  'into',
]);

/** A figure found in a text: where it is, and the keys that would source it (none: never). */
interface Found {
  start: number;
  end: number;
  keys: string[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
const monthOf = (word: string): number =>
  MONTHS.indexOf(word.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]) + 1;

/** The keys of a calendar day, or none when it is not one. */
function dayKeys(year: number, month: number, day: number): string[] {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return [];
  return [`date:${String(year)}-${pad(month)}-${pad(day)}`];
}

/** A value as text: whole numbers plain, others to two places. */
function valueText(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

const DATE_SHAPES: readonly { pattern: RegExp; keys: (m: RegExpExecArray) => string[] }[] = [
  {
    // 2026-11-14, with a time after it in a timestamp.
    pattern: /(?<![\d/-])(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d/-])/g,
    keys: (m) => dayKeys(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  {
    // 14-11-2026, 14/11/2026, 14.11.2026 (day first, as India writes it).
    pattern: /(?<![\d./-])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?![\d/-])/g,
    keys: (m) => dayKeys(Number(m[3]), Number(m[2]), Number(m[1])),
  },
  {
    // 14 November 2026, 14th Nov, 2026.
    pattern: new RegExp(
      `(?<!\\d)(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH},?\\s+(\\d{4})(?!\\d)`,
      'gi',
    ),
    keys: (m) => dayKeys(Number(m[3]), monthOf(m[2] ?? ''), Number(m[1])),
  },
  {
    // November 14, 2026.
    pattern: new RegExp(
      `(?<![\\p{L}])${MONTH}\\s+(\\d{1,2})${ORDINAL},?\\s+(\\d{4})(?!\\d)`,
      'giu',
    ),
    keys: (m) => dayKeys(Number(m[3]), monthOf(m[1] ?? ''), Number(m[2])),
  },
  {
    // November 2026.
    pattern: new RegExp(`(?<![\\p{L}])${MONTH},?\\s+(\\d{4})(?!\\d)`, 'giu'),
    keys: (m) => [`month:${String(Number(m[2]))}-${pad(monthOf(m[1] ?? ''))}`],
  },
  {
    // 14 November, 14th Nov.
    pattern: new RegExp(`(?<!\\d)(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH}(?![\\p{L}])`, 'giu'),
    keys: (m) => [`daymonth:${pad(monthOf(m[2] ?? ''))}-${pad(Number(m[1]))}`],
  },
  {
    // November 14.
    pattern: new RegExp(`(?<![\\p{L}])${MONTH}\\s+(\\d{1,2})${ORDINAL}(?![\\d\\p{L}])`, 'giu'),
    keys: (m) => [`daymonth:${pad(monthOf(m[1] ?? ''))}-${pad(Number(m[2]))}`],
  },
];

/** Letters and digits together, with / or - between parts: a document number, read whole. */
const DOCUMENT =
  /(?<![\p{L}\p{N}/-])(?=[\p{L}\p{N}/-]*\p{N})(?=[\p{L}\p{N}/-]*\p{L})[\p{L}\p{N}]+(?:[/-][\p{L}\p{N}]+)*(?![\p{L}\p{N}])/gu;

/** A number standing alone: no letter, digit, slash or hyphen joined to it before. */
const NUMBER = /(?<![\p{L}\p{N}/.-])\d+(?:,\d+)*(?:\.\d+)?(?![\p{N}])/gu;

const WORD = /[\p{L}]+/gu;

/** Where the rupee sign or word right before `at` starts, if there is one. */
function rupeeBefore(text: string, at: number): number | undefined {
  const m = /(₹|\brs\.?|\binr)\s*$/i.exec(text.slice(Math.max(0, at - 6), at));
  return m === null ? undefined : at - m[0].length;
}

/** The kind and value of the number at [start, end), from what stands around it. */
function typeNumber(text: string, start: number, end: number): Found {
  const value = Number(text.slice(start, end).replace(/,/g, ''));
  const rupeeStart = rupeeBefore(text, start);
  const from = rupeeStart ?? start;
  let at = end;
  // The magnitude words right after the digits, each after a space or a hyphen.
  const magnitudes: { word: string; separator: string }[] = [];
  for (;;) {
    const m = /^([ \t]+|-)([\p{L}]+)/u.exec(text.slice(at));
    if (m === null || !isMagnitudeLike(m[2] ?? '')) break;
    magnitudes.push({ word: (m[2] ?? '').toLowerCase(), separator: m[1] ?? '' });
    at += m[0].length;
  }
  let multiplier = 1;
  const [only] = magnitudes;
  if (only !== undefined) {
    const known = KNOWN_MAGNITUDE[only.word];
    // One known magnitude, singular, after a space; anything else is never sourced.
    if (magnitudes.length > 1 || known === undefined || only.separator === '-') {
      return { start: from, end: at, keys: [] };
    }
    multiplier = known;
  }
  let rupee = rupeeStart !== undefined;
  const rupeeWord = new RegExp(`^\\s+(${RUPEE_WORDS})\\.?(?![\\p{L}])`, 'iu').exec(text.slice(at));
  if (rupeeWord !== null) {
    rupee = true;
    at += rupeeWord[0].length;
  }
  if (rupee) {
    // An amount stands before punctuation, nothing or an ordinary word; any other word right
    // after it (an unknown magnitude such as `karod` or `grand`, a unit) leaves it unsourced.
    const next = /^[ \t]+([\p{L}]+)/u.exec(text.slice(at));
    if (next !== null && !AFTER_AMOUNT.has((next[1] ?? '').toLowerCase())) {
      return { start: from, end: at + next[0].length, keys: [] };
    }
    return { start: from, end: at, keys: [`inr:${valueText(value * multiplier)}`] };
  }
  if (only !== undefined) return { start: from, end: at, keys: [] };
  const points = POINTS_AFTER.exec(text.slice(at));
  if (points !== null) {
    return { start: from, end: at + points[0].length, keys: [`pp:${valueText(value)}`] };
  }
  const percent = PERCENT_AFTER.exec(text.slice(at));
  if (percent !== null) {
    return { start: from, end: at + percent[0].length, keys: [`pct:${valueText(value)}`] };
  }
  // A count: the digits right before a word.
  if (/^[ \t]+[\p{L}]/u.test(text.slice(at))) {
    return { start: from, end: at, keys: [`n:${valueText(value)}`] };
  }
  return { start: from, end: at, keys: [] };
}

/**
 * Every figure of `text`, left to right, each span read once: dates, then numbers standing alone
 * with their kind, then document numbers, then number words and any digits left, never sourced.
 */
function findFigures(text: string): Found[] {
  const found: Found[] = [];
  const taken = Array.from({ length: text.length }, () => false);
  const free = (f: Found) => !taken.slice(f.start, f.end).some(Boolean);
  const take = (f: Found) => {
    if (!free(f)) return;
    for (let i = f.start; i < f.end; i += 1) taken[i] = true;
    found.push(f);
  };
  for (const shape of DATE_SHAPES) {
    for (const m of text.matchAll(shape.pattern)) {
      const keys = shape.keys(m);
      if (keys.length > 0) take({ start: m.index, end: m.index + m[0].length, keys });
    }
  }
  for (const m of text.matchAll(NUMBER)) {
    const end = m.index + m[0].length;
    // A number joined to a letter (`7k`, `5HP`) is left to the document numbers.
    if (/^[\p{L}]/u.test(text.slice(end))) continue;
    if (!free({ start: m.index, end, keys: [] })) continue;
    take(typeNumber(text, m.index, end));
  }
  for (const m of text.matchAll(DOCUMENT)) {
    take({ start: m.index, end: m.index + m[0].length, keys: [`doc:${m[0].toUpperCase()}`] });
  }
  // Number words, in English or Roman Hindi, never sourced; side by side (`fifty lakh`, `do sau`,
  // `a dozen`) they are taken out as one.
  const words: RegExpExecArray[] = [...text.matchAll(WORD)];
  const joined = (a: RegExpExecArray | undefined, b: RegExpExecArray | undefined): boolean =>
    a !== undefined &&
    b !== undefined &&
    /^[ \t-]+$/.test(text.slice(a.index + a[0].length, b.index));
  const flagged = words.map((m, i) => {
    const word = m[0].toLowerCase();
    const next = joined(m, words[i + 1]) ? (words[i + 1]?.[0].toLowerCase() ?? '') : '';
    const previous = joined(words[i - 1], m) ? (words[i - 1]?.[0].toLowerCase() ?? '') : '';
    const counted = (w: string) => ENGLISH_NUMBERS.has(w) || w === 'a' || w === 'an';
    if (ENGLISH_NUMBERS.has(word)) return true;
    if (word === 'one') return isMagnitudeLike(next);
    if (HINDI_UNITS.has(word)) {
      return (
        isMagnitudeLike(next) ||
        RUPEE_WORD.test(next) ||
        /(₹|\brs\.?)\s*$/i.test(text.slice(Math.max(0, m.index - 4), m.index))
      );
    }
    if (word === 'a' || word === 'an') return isMagnitudeLike(next) && !SHORT_MAGNITUDES.has(next);
    if (/^scores?$/.test(word) || SHORT_MAGNITUDES.has(word)) return counted(previous);
    return isMagnitudeLike(word);
  });
  for (let i = 0; i < words.length; i += 1) {
    const first = words[i];
    if (first === undefined || flagged[i] !== true) continue;
    let last = first;
    while (flagged[i + 1] === true && joined(last, words[i + 1])) {
      i += 1;
      last = words[i] ?? last;
    }
    take({ start: first.index, end: last.index + last[0].length, keys: [] });
  }
  for (const m of text.matchAll(/\d+/g)) {
    take({ start: m.index, end: m.index + m[0].length, keys: [] });
  }
  return found.sort((a, b) => a.start - b.start);
}

function addKey(keys: Set<string>, key: string): void {
  keys.add(key);
  const day = /^date:(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (day) {
    keys.add(`month:${String(Number(day[1]))}-${day[2] ?? ''}`);
    keys.add(`daymonth:${day[2] ?? ''}-${day[3] ?? ''}`);
  }
}

/** What a text supplies: the keys of every figure it can type, the ids taken out first. */
function addTextKeys(keys: Set<string>, text: string): void {
  for (const f of findFigures(asciiDigits(text).replace(ANY_UUID, ' '))) {
    for (const key of f.keys) addKey(keys, key);
  }
}

/** The lookups' fields that name records: never a figure. */
const ID_FIELDS = new Set(['ref', 'lead', 'quote', 'id']);
/** The lookups' fields holding a document number, compared whole. */
const DOCUMENT_FIELDS = new Set(['number', 'code', 'oldestUnpaidInvoice']);
/** The lookups' number fields that are percentages. */
const PERCENT_FIELDS = new Set(['percentOfTarget']);

/** What one value of a lookup's answer supplies, by its field. */
function addValueKeys(keys: Set<string>, value: unknown, field: string): void {
  if (Array.isArray(value)) {
    for (const v of value) addValueKeys(keys, v, field);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) addValueKeys(keys, v, k);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      addKey(keys, `${PERCENT_FIELDS.has(field) ? 'pct' : 'n'}:${valueText(value)}`);
    }
    return;
  }
  if (typeof value !== 'string' || ID_FIELDS.has(field)) return;
  const text = asciiDigits(value).trim();
  if (DOCUMENT_FIELDS.has(field)) {
    addKey(keys, `doc:${text.toUpperCase()}`);
    return;
  }
  // A money field: rupees after ₹, as the lookups write them.
  const money = /^₹(\d+(?:\.\d+)?)$/.exec(text);
  if (money) {
    addKey(keys, `inr:${valueText(Number(money[1]))}`);
    return;
  }
  addTextKeys(keys, text);
}

/**
 * The keys of every figure the turn may give: the lookups' answers as JSON, read by their fields,
 * and plain texts (the question, today's date), read as an answer is.
 */
export function collectFigures(texts: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (parsed !== null && typeof parsed === 'object') addValueKeys(keys, parsed, '');
    else addTextKeys(keys, text);
  }
  return keys;
}

/**
 * Stand-ins for what is set aside while the figures are read: one character of a private-use
 * block per item, so no figure pattern can read a digit in it. A block holds 2,000 items, far
 * more than an answer's citations or list lines.
 */
const CITED_TOKENS = { base: 0xe000, pattern: /[-]/g };
const NUMBERING_TOKENS = { base: 0xe800, pattern: /[-]/g };
const token = (kind: { base: number }, i: number): string => String.fromCharCode(kind.base + i);
const untoken = (kind: { base: number }, t: string): number => t.charCodeAt(0) - kind.base;

/** A line's number at its start (`1. `, `2) `) and what follows it. */
const LINE_NUMBER = /^(\s*)(\d{1,2})([.)])(?=\s+(\S+))/u;

/**
 * Sets aside a list's own numbering: a line-start number is numbering only in a run counting up
 * from 1, and only before words that begin with no magnitude, rupee or percent word; any other
 * line-start number is a figure and is checked like the rest.
 */
function setAsideNumbering(text: string, numbering: string[]): string {
  let next = 1;
  return text
    .split('\n')
    .map((line) => {
      const m = LINE_NUMBER.exec(line);
      if (m === null) return line;
      const word = (m[4] ?? '').replace(/[^\p{L}%]/gu, '');
      if (
        isMagnitudeLike(word) ||
        RUPEE_WORD.test(word) ||
        /^(%|percent|pct|pc|percentage)$/i.test(word)
      ) {
        return line;
      }
      const n = Number(m[2]);
      if (n !== next && n !== 1) return line;
      next = n + 1;
      numbering.push(m[0]);
      return token(NUMBERING_TOKENS, numbering.length - 1) + line.slice(m[0].length);
    })
    .join('\n');
}

export interface GroundingFacts {
  /** Every record a lookup returned in this conversation, by id. */
  returned: ReadonlyMap<string, AskSource>;
  /** The figures of this turn's lookups and of the question (`collectFigures`). */
  figures: ReadonlySet<string>;
}

export interface GroundedAnswer {
  /** The answer as it may be shown: citations as `[ref:<id>]`, each failure as `UNSOURCED`. */
  text: string;
  /** The records it cites, in order of first citation, each once. */
  cited: AskSource[];
  /** How many figures and citations were taken out. */
  unsourced: number;
}

/** `text` cut to the stored length at the end of a sentence, when it is longer. */
function capped(text: string): string {
  if (text.length <= ASK_ANSWER_MAX) return text;
  const cut = text.slice(0, ASK_ANSWER_MAX);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('\n'));
  return end > ASK_ANSWER_MAX / 2 ? cut.slice(0, end + 1) : cut;
}

/**
 * The model's answer with every citation checked against the records returned and every figure
 * against the figures returned; whatever fails, or cannot be read with confidence, is replaced by
 * `UNSOURCED`. A citation beyond the fiftieth is dropped without a mark.
 */
export function groundAnswer(answer: string, facts: GroundingFacts): GroundedAnswer {
  const cited: AskSource[] = [];
  const citedIds = new Set<string>();
  let unsourced = 0;
  // Citations first, set aside as tokens no figure pattern reads.
  const kept: string[] = [];
  // Any private-use character the model wrote is dropped, so it cannot pass for a stand-in.
  let text = asciiDigits(answer)
    .replace(/\r\n?/g, '\n')
    .replace(/[-]/g, '')
    .replace(CITATION, (_all, marked?: string, bare?: string) => {
      const id = (marked ?? bare ?? '').toLowerCase();
      const source = facts.returned.get(id);
      if (source === undefined) {
        unsourced += 1;
        return UNSOURCED;
      }
      if (!citedIds.has(id)) {
        if (cited.length >= ASK_CITED_MAX) return '';
        citedIds.add(id);
        cited.push(source);
      }
      kept.push(id);
      return token(CITED_TOKENS, kept.length - 1);
    });
  // A list's numbering is kept as it is.
  const numbering: string[] = [];
  text = setAsideNumbering(text, numbering);
  let out = '';
  let at = 0;
  for (const f of findFigures(text)) {
    if (f.keys.some((k) => facts.figures.has(k))) continue;
    out += text.slice(at, f.start) + UNSOURCED;
    at = f.end;
    unsourced += 1;
  }
  out += text.slice(at);
  out = out
    .replace(NUMBERING_TOKENS.pattern, (t) => numbering[untoken(NUMBERING_TOKENS, t)] ?? '')
    .replace(CITED_TOKENS.pattern, (t) => citationMarker(kept[untoken(CITED_TOKENS, t)] ?? ''))
    .trim();
  return { text: capped(out), cited, unsourced };
}
