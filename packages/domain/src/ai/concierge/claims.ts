import { findPersonalNumbers } from '../../privacy/number-shapes';
import { asciiDigits } from '../../privacy/model-text';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';

// What a Concierge reply may state only by quoting a rule it cites (A3, docs/03-roadmap-appendix/
// phase2.md §7.2, the review's H1): an amount or any number, a price, a date or a day, a time, an
// offer, a subsidy, a warranty, or a commitment (a delivery, a visit, an order confirmed), written
// in digits or in words, in English or Roman Hindi. Each is a claim; a sentence that holds one
// passes only when one directive the reply cites holds the same claims. The reading is
// deterministic and kept wide: a doubtful sentence is refused, and a refused draft hands the chat
// to people, which is safe. Words are compared folded (accents and joiners gone, repeated letters
// once, so "paanch" and "panch", "hazaar" and "hazar", "tomorrow" and "tommorow" read alike).

/** Kinds of claim; the first three are figures, the rest promises. */
export type ClaimKind =
  'number' | 'money' | 'date' | 'offer' | 'subsidy' | 'warranty' | 'commitment';

/** The kinds whose claim, ungrounded, is a figure nothing read gives (`fact_not_grounded`). */
export const FIGURE_CLAIMS: ReadonlySet<ClaimKind> = new Set(['number', 'money', 'date']);

/** Number words, English and Roman Hindi; a word made of them alone ("twentyfive") is one too. */
const NUMBER_WORDS = [
  'one',
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
  'fourty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
  'million',
  'billion',
  'lakh',
  'lac',
  'crore',
  'half',
  'quarter',
  'double',
  'triple',
  'twice',
  'dozen',
  'ek',
  'teen',
  'char',
  'chaar',
  'paanch',
  'panch',
  'paach',
  'chhe',
  'chhah',
  'chhai',
  'saat',
  'aath',
  'nau',
  'das',
  'dus',
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
  'ikkis',
  'bais',
  'pachees',
  'pachis',
  'tees',
  'chalis',
  'chaalis',
  'chaalees',
  'pachas',
  'pachaas',
  'saath',
  'sattar',
  'assi',
  'nabbe',
  'sau',
  'hazaar',
  'hazar',
  'hajar',
  'hajaar',
  'karod',
  'karor',
  'arab',
  'aadha',
  'aadhi',
  'aadhe',
  'dedh',
  'dhai',
  'dhaai',
  'sawa',
  'savaa',
  'paune',
  'pauna',
  'dugna',
  'dugni',
] as const;

/**
 * The words of each other kind, in English and Roman Hindi. A word ending in `*` stands for every
 * word it begins (`deliver*`: deliver, delivers, delivered, delivery); a phrase is its words with
 * any spacing between them.
 */
const CLAIM_WORDS: Readonly<Record<Exclude<ClaimKind, 'number'>, readonly string[]>> = {
  money: [
    'rupee*',
    'rupaye',
    'rupaiye',
    'rupaya',
    'rupiya',
    'rupiye',
    'rs',
    'inr',
    'paisa',
    'paise',
    'price*',
    'cost*',
    'rate',
    'rates',
    'rated',
    'charge*',
    'fee',
    'fees',
    'amount*',
    'pay',
    'pays',
    'paid',
    'paying',
    'payment*',
    'payable',
    'emi',
    'emis',
    'loan*',
    'keemat',
    'kimat',
    'daam',
    'mulya',
    'bhav',
    'lagega',
    'lagegi',
    'cheap*',
    'expensive',
    'sasta',
    'saste',
    'mehenga',
    'mehnga',
    'afford*',
    'save',
    'saves',
    'saved',
    'saving*',
    'bachat',
    'bachega',
    'worth',
    'mrp',
    'gst',
    'tax',
    'taxes',
    'percent*',
    'per cent',
    'pratishat',
  ],
  date: [
    'today',
    'todays',
    'tonight',
    'tomorrow',
    'tmrw',
    'tmr',
    'yesterday',
    'kal',
    'parso',
    'parson',
    'narso',
    'aaj',
    'week*',
    'month',
    'months',
    'year',
    'years',
    'yearly',
    'hour*',
    'hrs',
    'minute*',
    'mins',
    'days',
    'din',
    'dino',
    'saal',
    'varsh',
    'ghanta',
    'ghante',
    'mahina',
    'mahine',
    'hafta',
    'hafte',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'somvar',
    'somwar',
    'mangalvar',
    'mangalwar',
    'budhvar',
    'budhwar',
    'guruvar',
    'guruwar',
    'brihaspativar',
    'shukravar',
    'shukrawar',
    'shanivar',
    'shaniwar',
    'ravivar',
    'raviwar',
    'itvar',
    'itwar',
    'january',
    'february',
    'march',
    'april',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'jan',
    'feb',
    'apr',
    'jun',
    'jul',
    'aug',
    'sep',
    'sept',
    'oct',
    'nov',
    'dec',
    'pm',
    'baje',
    'bje',
    'oclock',
    'o clock',
    'noon',
    'midnight',
    'subah',
    'shaam',
    'dopahar',
    'raat',
    'date*',
    'deadline*',
    'schedul*',
  ],
  offer: [
    'offer*',
    'deal',
    'deals',
    'sale',
    'special price',
    'bonus*',
    'gift*',
    'extra',
    'complimentary',
    'no cost',
    'zero cost',
    'no charge',
    'inam',
    'uphar',
    'best rate',
  ],
  subsidy: [
    'subsid*',
    'sabsidi',
    'anudan',
    'government*',
    'govt',
    'sarkar',
    'sarkari',
    'scheme*',
    'yojana',
    'kusum',
    'surya ghar',
    'mnre',
    'refund*',
    'reimburs*',
    'money back',
    'wapas',
    'vapas',
    'eligib*',
    'approv*',
  ],
  warranty: [
    'warrant*',
    'waranty',
    'warrenty',
    'guarant*',
    'gaurant*',
    'garanti',
    'lifetime',
    'life time',
    'lifelong',
    'life long',
  ],
  commitment: [
    'confirm*',
    'book*',
    'order*',
    'deliver*',
    'dispatch*',
    'ship',
    'ships',
    'shipped',
    'shipping',
    'shipment*',
    'courier*',
    'install*',
    'fitting',
    'fitted',
    'visit*',
    'survey*',
    'engineer*',
    'technician*',
    'mechanic*',
    'plumber*',
    'electrician*',
    'reach*',
    'arriv*',
    'pahunch*',
    'pahuch*',
    'aayega',
    'ayega',
    'aayegi',
    'aa jayega',
    'aa jayegi',
    'aajayega',
    'milega',
    'milegi',
    'mil jayega',
    'mil jayegi',
    'bhej*',
    'ho jayega',
    'ho jayegi',
    'kar denge',
    'lagwa*',
    'lag jayega',
    'definitely',
    'vaada',
    'wada',
    'vada',
    'zaroor',
    'zarur',
    'jaroor',
    'jarur',
    'commit*',
    'ensur*',
    'assur*',
    'stock*',
    'available',
    'availability',
    'uplabdh',
    'ready',
    'complete*',
    'immediately',
    'turant',
    'within',
  ],
};

/** Text with accents, joiners and format characters gone, in lower case, repeated letters once. */
function folded(text: string, joiner: '' | ' '): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}|\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/(?<=\p{L})['’`\-_*~·.](?=\p{L})/gu, joiner)
    .replace(/(\p{L})\1+/gu, '$1');
}

/** A word or phrase of the lists, folded the same way as the text it is looked for in. */
const foldWord = (word: string): string => folded(word, ' ').replace(/\s+/g, ' ').trim();

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Entry {
  kind: Exclude<ClaimKind, 'number'>;
  /** The folded word, or the folded beginning for a `*` word: what two claims compare by. */
  key: string;
  pattern: RegExp;
}

function entry(kind: Entry['kind'], word: string): Entry {
  const prefix = word.endsWith('*');
  const key = foldWord(prefix ? word.slice(0, -1) : word);
  const body =
    key
      .split(' ')
      .map(escape)
      .join(String.raw`\s+`) + (prefix ? String.raw`\p{L}*` : '');
  return {
    kind,
    key,
    pattern: new RegExp(String.raw`(?<![\p{L}\p{N}])${body}(?![\p{L}\p{N}])`, 'gu'),
  };
}

/** Every entry, the price and subsidy hand-off words of the sales head's list included. */
const ENTRIES: readonly Entry[] = (() => {
  const words: [Entry['kind'], readonly string[]][] = [
    ...(Object.entries(CLAIM_WORDS) as [Entry['kind'], readonly string[]][]),
    ['money', WORKSHOP_DEFAULTS.whatsapp.handoffWords.price],
    ['subsidy', WORKSHOP_DEFAULTS.whatsapp.handoffWords.subsidy],
  ];
  const seen = new Set<string>();
  return words.flatMap(([kind, list]) =>
    list.flatMap((word) => {
      const made = entry(kind, word);
      const id = `${made.kind}:${made.key}:${made.pattern.source}`;
      if (seen.has(id)) return [];
      seen.add(id);
      return [made];
    }),
  );
})();

/** A word made of number words alone, with a plural `s` at most. */
const NUMBER_TOKEN = new RegExp(
  String.raw`^(?:${[...new Set(NUMBER_WORDS.map(foldWord))]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|')})+s?$`,
  'u',
);

/** Signs of money or a share. */
const MONEY_SIGNS = /[₹$€£%]|\/-/g;

/** A figure in digits, any script's digits read as ASCII. */
const DIGITS = /\d+(?:[.,]\d+)*/g;

/** Text as figures are read in it: compatibility forms folded, any script's digits as ASCII. */
const digitsOf = (text: string): string => asciiDigits(text.normalize('NFKD'));

/** The text with the company's own phone numbers blanked, which a reply may name. */
export function withoutOwnNumbers(text: string, companyNumbers: readonly string[]): string {
  const own = new Set(companyNumbers.map((n) => n.replace(/\D/g, '').slice(-10)));
  let out = text;
  for (const found of findPersonalNumbers(text).reverse()) {
    if (own.has(found.digits.slice(-10))) {
      out = out.slice(0, found.start) + ' '.repeat(found.end - found.start) + out.slice(found.end);
    }
  }
  return out;
}

/** Words a reply may put before a customer's name ("Mr Das", "Shri Das"). */
const NAME_BEFORE = ['mr', 'mrs', 'ms', 'shri', 'sri', 'smt', 'shrimati'];

/** Words a reply may put after a customer's name ("Das ji", "Das sahab"). */
const NAME_AFTER = ['ji', 'sir', 'madam', 'sahab', 'saheb'];

/** At most this many words make a name the exemption reads. */
const NAME_MAX_WORDS = 5;

/** The word just before `at` and the one just after `to` in `text`, spaces skipped. */
function neighbours(text: string, at: number, to: number): [string, string] {
  const before = /(\p{L}+)\s*$/u.exec(text.slice(0, at))?.[1] ?? '';
  const after = /^\s*(\p{L}+)/u.exec(text.slice(to))?.[1] ?? '';
  return [before, after];
}

/**
 * The text with the customer's own name blanked where it stands as that name, so a name with a
 * word that is also a number word ("Ramesh Das", "Sat Pal") does not read as a figure in a
 * greeting. It stands as the name when written whole ("Ramesh Das"), or the whole name or one word
 * of it beside a title ("Mr Das", "Das ji"). The name is untrusted (it can come from the customer's
 * WhatsApp profile), so the exemption is narrow:
 * - a name of number words alone ("Das", "Paanch Hazaar"), one holding a money, day or promise
 *   word, or one of more than five words exempts nothing;
 * - a match is left alone when the word beside it (spaces skipped) is a number word or any other
 *   claim, or another match, so matches cannot chain into a number phrase ("Mr Das das ji");
 * - a number word anywhere else is still a claim.
 */
export function withoutCustomerName(text: string, name: string | null | undefined): string {
  if (name === null || name === undefined) return text;
  const words = name
    .normalize('NFKC')
    .split(/[^\p{L}]+/u)
    .filter((w) => w !== '');
  if (words.length === 0 || words.length > NAME_MAX_WORDS) return text;
  const claims = claimsIn(words.join(' '));
  if (claims.length === 0 || claims.some((c) => c.kind !== 'number')) return text;
  // A name of number words alone cannot be told from the number, titled or not.
  if (words.every((w) => claimsIn(w).length > 0)) return text;
  const whole = words.map(escape).join(String.raw`[\s.]+`);
  const named = [whole, ...words.map(escape)].join('|');
  const before = NAME_BEFORE.map(escape).join('|');
  const after = NAME_AFTER.map(escape).join('|');
  const forms = [
    String.raw`(?:${before})\.?\s+(?:${named})`,
    String.raw`(?:${named})\s+(?:${after})`,
    whole,
  ];
  const pattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:${forms.join('|')})(?![\p{L}\p{N}])`,
    'giu',
  );
  const found = [...text.matchAll(pattern)].map((m) => ({
    at: m.index,
    to: m.index + m[0].length,
  }));
  // A match touching another (spaces between them only) is no name standing alone.
  const touches = (a: { at: number; to: number }, b: { at: number; to: number }): boolean =>
    /^\s*$/u.test(text.slice(Math.min(a.to, b.to), Math.max(a.at, b.at)));
  let out = text;
  for (const [i, span] of found.entries()) {
    const [left, right] = neighbours(text, span.at, span.to);
    const claimBeside = [left, right].some((w) => w !== '' && claimsIn(w).length > 0);
    const chained = found.some((other, j) => j !== i && touches(span, other));
    if (claimBeside || chained) continue;
    out = out.slice(0, span.at) + ' '.repeat(span.to - span.at) + out.slice(span.to);
  }
  return out;
}

/** One claim of a text: its kind and what two claims compare by. */
export interface Claim {
  kind: ClaimKind;
  key: string;
}

const claimId = (c: Claim): string => `${c.kind}:${c.key}`;

/** Every claim `text` makes, each once. */
export function claimsIn(text: string): Claim[] {
  const found = new Map<string, Claim>();
  const add = (claim: Claim) => found.set(claimId(claim), claim);
  for (const joiner of ['', ' '] as const) {
    const read = folded(text, joiner);
    for (const e of ENTRIES) {
      if (e.pattern.test(read)) add({ kind: e.kind, key: e.key });
      e.pattern.lastIndex = 0;
    }
    for (const token of read.split(/[^\p{L}]+/u)) {
      if (token !== '' && NUMBER_TOKEN.test(token)) add({ kind: 'number', key: token });
    }
  }
  for (const m of text.matchAll(MONEY_SIGNS)) add({ kind: 'money', key: m[0] });
  for (const m of digitsOf(text).matchAll(DIGITS)) {
    add({ kind: 'number', key: m[0].replace(/,/g, '') });
  }
  return [...found.values()];
}

/** The sentences of a reply: split after a full stop, a question or exclamation mark, or a line. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?।])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * The claims of `sentence` that no one of the `cited` texts holds all of with it: none when the
 * sentence makes no claim, or one cited text makes every claim it makes.
 */
export function ungroundedClaims(sentence: string, cited: readonly string[]): Claim[] {
  const claims = claimsIn(sentence);
  if (claims.length === 0) return [];
  let best = claims;
  for (const text of cited) {
    const held = new Set(claimsIn(text).map(claimId));
    const missing = claims.filter((c) => !held.has(claimId(c)));
    if (missing.length < best.length) best = missing;
    if (best.length === 0) return [];
  }
  return best;
}

/** A letter of a script other than Latin (Devanagari, Cyrillic, Greek…) in a reply. */
export const NOT_LATIN = /(?![\p{Script=Latin}])\p{L}/u;

/** Single letters spaced out to spell a word ("f i f t y", "p.r.i.c.e"). */
export const SPELLED_OUT =
  /(?<![\p{L}\p{N}])\p{L}(?:[^\p{L}\p{N}\n]{1,3}\p{L}(?![\p{L}\p{N}])){3,}/u;

/** Whether `text` has a letter other than Latin, once accents are gone. */
export const hasOtherScript = (text: string): boolean =>
  NOT_LATIN.test(text.normalize('NFKD').replace(/\p{M}|\p{Cf}/gu, ''));
