/**
 * Normalising transcripts before they are compared (docs/03-roadmap-appendix/phase2.md §5.3 and
 * §9.2): lower case, numbers as digits, spelling variants folded by a list, so that "Paanch H.P."
 * and "5 hp" count as the same words. The reference and the vendor's transcript pass through the
 * same function, so a mapping that is wrong in a sentence (the Hindi "do" as "give", "saath" as
 * "with") is wrong on both sides alike and adds no error.
 *
 * The list is a starting list of common Roman spellings; the team extends it from the stand-in
 * set's references, and a change reruns the benchmark on both vendors.
 */

/** Variant spellings and phrases (left) folded to one form (right); phrases of up to three words. */
export const SPELLING_VARIANTS: ReadonlyMap<string, string> = new Map([
  // Everyday Hinglish.
  ['he', 'hai'],
  ['hain', 'hai'],
  ['kyaa', 'kya'],
  ['nahin', 'nahi'],
  ['nhi', 'nahi'],
  ['chahie', 'chahiye'],
  ['chaiye', 'chahiye'],
  ['kitnaa', 'kitna'],
  ['pani', 'paani'],
  ['kimat', 'keemat'],
  ['kimmat', 'keemat'],
  // Money.
  ['rupay', 'rupaye'],
  ['rupaiye', 'rupaye'],
  ['rupee', 'rupaye'],
  ['rupees', 'rupaye'],
  ['rs', 'rupaye'],
  ['hazar', 'hazaar'],
  ['hajar', 'hazaar'],
  ['hajaar', 'hazaar'],
  ['lac', 'lakh'],
  ['lakhs', 'lakh'],
  ['laakh', 'lakh'],
  ['crores', 'crore'],
  ['karod', 'crore'],
  ['karor', 'crore'],
  // Number words.
  ['panch', 'paanch'],
  ['paach', 'paanch'],
  ['char', 'chaar'],
  ['tin', 'teen'],
  ['chhe', 'chhah'],
  ['chah', 'chhah'],
  ['ath', 'aath'],
  ['dus', 'das'],
  ['gyarah', 'gyaarah'],
  ['barah', 'baarah'],
  ['bis', 'bees'],
  ['pachees', 'pachchees'],
  ['pachis', 'pachchees'],
  ['pachas', 'pachaas'],
  ['dhai', 'dhaai'],
  ['derh', 'dedh'],
  ['sadhe', 'saadhe'],
  ['sava', 'sawa'],
  ['savaa', 'sawa'],
  // Pumps and solar.
  ['horsepower', 'hp'],
  ['horse power', 'hp'],
  ['kilowatt', 'kw'],
  ['kilo watt', 'kw'],
  ['kilowatts', 'kw'],
  ['bore well', 'borewell'],
  ['submersable', 'submersible'],
  ['soler', 'solar'],
  ['on grid', 'ongrid'],
  ['off grid', 'offgrid'],
]);

const ENGLISH_UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
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

const ENGLISH_TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Hindi numbers 0 to 99 have a word each; one common Roman spelling of each. */
const HINDI_NUMBERS: readonly string[] = [
  'shunya',
  'ek',
  'do',
  'teen',
  'chaar',
  'paanch',
  'chhah',
  'saat',
  'aath',
  'nau',
  'das',
  'gyaarah',
  'baarah',
  'terah',
  'chaudah',
  'pandrah',
  'solah',
  'satrah',
  'athaarah',
  'unnees',
  'bees',
  'ikkees',
  'baaees',
  'teyees',
  'chaubees',
  'pachchees',
  'chhabbees',
  'sattaees',
  'atthaees',
  'untees',
  'tees',
  'ikattees',
  'battees',
  'taintees',
  'chauntees',
  'paintees',
  'chhattees',
  'saintees',
  'adtees',
  'untaalees',
  'chaalees',
  'iktaalees',
  'bayaalees',
  'taintaalees',
  'chavaalees',
  'paintaalees',
  'chhiyaalees',
  'saintaalees',
  'adtaalees',
  'unchaas',
  'pachaas',
  'ikyaavan',
  'baavan',
  'tirepan',
  'chauvan',
  'pachpan',
  'chhappan',
  'sattaavan',
  'atthaavan',
  'unsath',
  'saath',
  'iksath',
  'baasath',
  'tirsath',
  'chausath',
  'painsath',
  'chhiyaasath',
  'sadsath',
  'adsath',
  'unhattar',
  'sattar',
  'ikhattar',
  'bahattar',
  'tihattar',
  'chauhattar',
  'pachhattar',
  'chhihattar',
  'satattar',
  'athhattar',
  'unyaasi',
  'assi',
  'ikyaasi',
  'bayaasi',
  'tiraasi',
  'chauraasi',
  'pachaasi',
  'chhiyaasi',
  'sattaasi',
  'atthaasi',
  'navaasi',
  'nabbe',
  'ikyaanve',
  'baanve',
  'tiraanve',
  'chauraanve',
  'pachaanve',
  'chhiyaanve',
  'sattaanve',
  'atthaanve',
  'ninyaanve',
];

const FRACTION_WORDS: Readonly<Record<string, number>> = { dedh: 1.5, dhaai: 2.5 };
/** Words that change the number after them: "saadhe teen" is 3.5, "sawa do" 2.25, "paune do" 1.75. */
const PREFIX_WORDS: Readonly<Record<string, number>> = { saadhe: 0.5, sawa: 0.25, paune: -0.25 };
const MULTIPLIERS: Readonly<Record<string, number>> = {
  sau: 100,
  hundred: 100,
  hazaar: 1_000,
  thousand: 1_000,
  lakh: 100_000,
  million: 1_000_000,
  crore: 10_000_000,
};

const DIGITS = /^\d+(\.\d+)?$/;

function unitValue(token: string): { value: number; englishTens: boolean } | undefined {
  if (DIGITS.test(token)) return { value: Number(token), englishTens: false };
  const english = ENGLISH_UNITS[token];
  if (english !== undefined) return { value: english, englishTens: false };
  const tens = ENGLISH_TENS[token];
  if (tens !== undefined) return { value: tens, englishTens: true };
  const fraction = FRACTION_WORDS[token];
  if (fraction !== undefined) return { value: fraction, englishTens: false };
  const hindi = HINDI_NUMBERS.indexOf(token);
  return hindi === -1 ? undefined : { value: hindi, englishTens: false };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** Turns runs of number words and digits into one number in digits: "ek lakh pachchees hazaar" → "125000". */
export function numbersAsDigits(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let total = 0;
    let current: number | undefined;
    let prefix = 0;
    let afterHundred = false;
    let afterTens = false;
    let j = i;
    for (; j < tokens.length; j += 1) {
      const token = tokens[j] ?? '';
      const next = tokens[j + 1];
      const shift = PREFIX_WORDS[token];
      if (shift !== undefined && current === undefined && next !== undefined && unitValue(next)) {
        prefix = shift;
        continue;
      }
      const unit = unitValue(token);
      if (unit !== undefined) {
        if (current === undefined) current = unit.value + prefix;
        else if (afterHundred && unit.value < 100) current += unit.value;
        else if (afterTens && unit.value < 10 && !unit.englishTens) current += unit.value;
        else break;
        prefix = 0;
        afterHundred = false;
        afterTens = unit.englishTens;
        continue;
      }
      const multiplier = MULTIPLIERS[token];
      if (multiplier === undefined || prefix !== 0) break;
      if (multiplier === 100) {
        current = (current ?? 1) * 100;
        afterHundred = true;
      } else {
        total += (current ?? 1) * multiplier;
        current = undefined;
        afterHundred = false;
      }
      afterTens = false;
    }
    if (j === i) {
      out.push(tokens[i] ?? '');
      i += 1;
    } else {
      // A prefix word that turned out to have no number after it stays a word.
      out.push(formatNumber(total + (current ?? 0)));
      i = j;
    }
  }
  return out;
}

/** Folds the variants, longest phrase first (three words, then two, then one). */
function foldVariants(tokens: readonly string[], variants: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let length = 3; length >= 1 && !matched; length -= 1) {
      if (i + length > tokens.length) continue;
      const phrase = tokens.slice(i, i + length).join(' ');
      const folded = variants.get(phrase);
      if (folded !== undefined) {
        out.push(...folded.split(' '));
        i += length;
        matched = true;
      }
    }
    if (!matched) {
      out.push(tokens[i] ?? '');
      i += 1;
    }
  }
  return out;
}

/** Joins runs of two or more single letters: "h p" → "hp", "s s p" → "ssp". */
function joinSpelledLetters(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const token of tokens) {
    if (/^\p{L}$/u.test(token)) run.push(token);
    else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

export function normalise(
  text: string,
  variants: ReadonlyMap<string, string> = SPELLING_VARIANTS,
): string {
  const cleaned = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/₹/gu, ' rupaye ')
    // Indian and Western digit grouping: 1,25,000 and 125,000 are 125000.
    .replace(/(\d),(?=\d)/gu, '$1')
    // A decimal point stays between digits (held as a private-use mark); every other mark is a space.
    .replace(/(\d)\.(?=\d)/gu, '$1\uE000')
    .replace(/[^\p{L}\p{N}\uE000]+/gu, ' ')
    .replace(/\uE000/gu, '.');
  const tokens = cleaned.split(' ').filter((t) => t !== '');
  return numbersAsDigits(foldVariants(joinSpelledLetters(tokens), variants)).join(' ');
}
