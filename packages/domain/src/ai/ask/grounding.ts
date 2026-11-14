import { ASK_ANSWER_MAX, ASK_CITED_MAX, type AskSource } from '@shakti/contracts';

// The grounding filter of Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5): pure and
// deterministic, so no model decides what reaches a person. An answer may cite only a record a
// lookup returned in this conversation, and every figure in it (a count, an amount, a date) must
// be one a lookup returned in this turn or the person wrote in their question. Whatever fails is
// taken out and replaced by `UNSOURCED`, which the screen says in words, so a figure nobody can
// trace back is never shown.
//
// Figures are read the same way from the answer and from the lookups' answers, so a quote number
// or a date is compared in the same form on both sides:
// - dates (`14-11-2026`, `2026-11-14`, `14 November 2026`, `Nov 14, 2026`) as the calendar day,
//   a month and year (`November 2026`) as the month, a day and month (`14 Nov`) as both;
// - amounts and counts (`₹1,20,000`, `1.2 lakh`, `3 crore`, `45%`, `7.5`) as their value, lakh and
//   crore multiplied out, grouping commas dropped;
// - number words from two to ninety-nine (`twelve`, `twenty-five`) as their value; "one" and
//   "zero" are left alone, since they mostly are not figures ("the one in Jaipur").
// A list's own numbering at the start of a line is not a figure.

/** What the answer shows in place of a figure or a citation that could not be sourced. */
export const UNSOURCED = '[unsourced]';

/** A citation as the model writes it and the screen reads it. */
export const citationMarker = (id: string): string => `[ref:${id}]`;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CITATION = new RegExp(
  `\\[\\s*ref\\s*:\\s*(${UUID})\\s*\\]|(?<![0-9a-z-])(${UUID})(?![0-9a-z-])`,
  'gi',
);

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

const WORDS: Readonly<Record<string, number>> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const UNITS = 'one|two|three|four|five|six|seven|eight|nine';
const NUMBER_WORD = new RegExp(
  `(?<![\\p{L}])(?:(${Object.keys(TENS).join('|')})(?:[ -](${UNITS}))?|(${Object.keys(WORDS).join('|')}))(?![\\p{L}])`,
  'giu',
);

/** One kind of figure: its pattern and the keys it stands for (none: not a figure). */
interface Shape {
  pattern: RegExp;
  keys: (m: RegExpExecArray) => string[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
const monthOf = (word: string): number =>
  MONTHS.indexOf(word.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]) + 1;

/** The keys of a calendar day, or none when it is not one. */
function dayKeys(year: number, month: number, day: number): string[] {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return [];
  return [`date:${String(year)}-${pad(month)}-${pad(day)}`];
}

/** The value of an amount or count as text: whole numbers plain, others to two places. */
function valueKey(value: number): string {
  if (!Number.isFinite(value)) return 'n:?';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `n:${String(rounded)}` : `n:${rounded.toFixed(2)}`;
}

const MULTIPLIER: Readonly<Record<string, number>> = {
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
};

// Order matters: a date is read before the numbers inside it, an amount before its digits.
const SHAPES: readonly Shape[] = [
  {
    // 2026-11-14, with a time after it in a timestamp.
    pattern: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?(?!\d)/g,
    keys: (m) => dayKeys(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  {
    // 14-11-2026, 14/11/2026, 14.11.2026 (day first, as India writes it).
    pattern: /(?<![\d.])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?![\d])/g,
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
  {
    // An amount or a count: ₹1,20,000.50, Rs 3.5 lakh, 45%, 7.5.
    pattern:
      /(?:(?:₹|\brs\.?|\binr)\s*)?(?<![\d.])(\d+(?:,\d+)*(?:\.\d+)?)(?:\s*(lakhs?|lacs?|crores?|cr)\b)?/giu,
    keys: (m) => {
      const value = Number((m[1] ?? '').replace(/,/g, ''));
      const unit = (m[2] ?? '').toLowerCase();
      return [valueKey(value * (MULTIPLIER[unit] ?? 1))];
    },
  },
];

/** A figure found in a text: where it is and the keys that would source it. */
interface Found {
  start: number;
  end: number;
  keys: string[];
}

/** Every figure of `text`, left to right, each span read once by the first shape that fits. */
function findFigures(text: string): Found[] {
  const found: Found[] = [];
  const taken = Array.from({ length: text.length }, () => false);
  const free = (start: number, end: number) => !taken.slice(start, end).some(Boolean);
  for (const shape of SHAPES) {
    for (const m of text.matchAll(shape.pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const keys = shape.keys(m);
      if (keys.length === 0) continue;
      for (let i = start; i < end; i += 1) taken[i] = true;
      found.push({ start, end, keys });
    }
  }
  for (const m of text.matchAll(NUMBER_WORD)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!free(start, end)) continue;
    const [, tens, unit, word] = m;
    const value =
      word !== undefined
        ? (WORDS[word.toLowerCase()] ?? 0)
        : (TENS[(tens ?? '').toLowerCase()] ?? 0) +
          (unit === undefined ? 0 : (WORDS[unit.toLowerCase()] ?? 1));
    found.push({ start, end, keys: [valueKey(value)] });
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The keys of every figure in `texts` (the lookups' answers as JSON, and the question): a day also
 * gives its month, its day and month and its year, so an answer may name any of them.
 */
export function collectFigures(texts: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts) {
    for (const f of findFigures(text)) {
      for (const key of f.keys) {
        keys.add(key);
        const day = /^date:(\d{4})-(\d{2})-(\d{2})$/.exec(key);
        if (day) {
          keys.add(`month:${String(Number(day[1]))}-${day[2] ?? ''}`);
          keys.add(`daymonth:${day[2] ?? ''}-${day[3] ?? ''}`);
          keys.add(valueKey(Number(day[1])));
        }
      }
    }
  }
  return keys;
}

/**
 * Stand-ins for what is set aside while the figures are read: one character of a private-use
 * block per item, so no figure pattern can read a digit in it. A block holds 2,000 items, far
 * more than an answer's citations or list lines.
 */
const CITED_TOKENS = { base: 0xe000, pattern: /[\ue000-\ue7cf]/g };
const NUMBERING_TOKENS = { base: 0xe800, pattern: /[\ue800-\uefcf]/g };
const token = (kind: { base: number }, i: number): string => String.fromCharCode(kind.base + i);
const untoken = (kind: { base: number }, t: string): number => t.charCodeAt(0) - kind.base;

/** A list's own numbering at the start of a line (`1. `, `2) `). */
const LIST_NUMBER = /^(\s*)\d{1,2}[.)](?=\s)/gm;

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
 * against the figures returned; whatever fails is replaced by `UNSOURCED`. A citation beyond the
 * fiftieth is dropped without a mark.
 */
export function groundAnswer(answer: string, facts: GroundingFacts): GroundedAnswer {
  const cited: AskSource[] = [];
  const citedIds = new Set<string>();
  let unsourced = 0;
  // Citations first, set aside as tokens no figure pattern reads.
  const kept: string[] = [];
  // Any private-use character the model wrote is dropped, so it cannot pass for a stand-in.
  let text = answer
    .replace(/\r\n?/g, '\n')
    .replace(/[\ue000-\uf8ff]/g, '')
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
  text = text.replace(LIST_NUMBER, (all) => {
    numbering.push(all);
    return token(NUMBERING_TOKENS, numbering.length - 1);
  });
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
