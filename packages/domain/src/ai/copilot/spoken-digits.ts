// A number spoken digit by digit in a call ("nau aath saat chhe ...", "nine eight double seven
// ..."), as the speech service writes it in Roman script, turned into numerals before the
// transcript is masked, so a 12-digit identity number or a phone number said aloud is masked
// whole like one written in figures (the review of A2, finding 13). Only a call's transcript reads
// numbers this way: a run of digit words is a number only in speech, so the shared finder of
// `packages/domain/src/privacy` keeps its own rules for every other text.

/** Each digit word in English and in Hindi written in Roman script, with its digit. */
const DIGIT_WORDS: Readonly<Record<string, string>> = {
  zero: '0',
  oh: '0',
  shunya: '0',
  shoonya: '0',
  sunya: '0',
  one: '1',
  ek: '1',
  two: '2',
  do: '2',
  three: '3',
  teen: '3',
  tin: '3',
  four: '4',
  char: '4',
  chaar: '4',
  five: '5',
  paanch: '5',
  panch: '5',
  paach: '5',
  six: '6',
  chhe: '6',
  chhah: '6',
  chah: '6',
  che: '6',
  chhai: '6',
  seven: '7',
  saat: '7',
  sat: '7',
  eight: '8',
  aath: '8',
  ath: '8',
  aat: '8',
  nine: '9',
  nau: '9',
  nao: '9',
};

/** "double five" is 55 and "triple zero" 000, in either language. */
const REPEATS: Readonly<Record<string, number>> = { double: 2, dabal: 2, triple: 3, tripal: 3 };

/** The fewest digits a run must come to before it is read as a number said digit by digit. */
export const SPOKEN_RUN_MIN_DIGITS = 6;

const WORD = Object.keys(DIGIT_WORDS).join('|');
const REPEAT = Object.keys(REPEATS).join('|');
const TOKEN = `(?:(?:${REPEAT})\\s+(?:${WORD})|${WORD}|\\d+)`;
const RUN = new RegExp(
  `(?<![\\p{L}\\p{N}])${TOKEN}(?:[\\s,.\\-]+${TOKEN})+(?![\\p{L}\\p{N}])`,
  'giu',
);
const PART = new RegExp(`(?:(${REPEAT})\\s+(${WORD}))|(${WORD})|(\\d+)`, 'giu');

/** The digits a run of spoken digits comes to, and whether any of it was a word. */
function digitsOf(run: string): { digits: string; spoken: boolean } {
  let digits = '';
  let spoken = false;
  for (const m of run.matchAll(PART)) {
    const [, repeat, repeated, word, figures] = m;
    if (repeat !== undefined && repeated !== undefined) {
      digits += (DIGIT_WORDS[repeated.toLowerCase()] ?? '').repeat(
        REPEATS[repeat.toLowerCase()] ?? 1,
      );
      spoken = true;
    } else if (word !== undefined) {
      digits += DIGIT_WORDS[word.toLowerCase()] ?? '';
      spoken = true;
    } else if (figures !== undefined) {
      digits += figures;
    }
  }
  return { digits, spoken };
}

/**
 * `text` with each run of spoken digits (words, figures or both, with "double" and "triple")
 * of at least `SPOKEN_RUN_MIN_DIGITS` digits written as figures, so the masking that follows reads
 * it as a number. A shorter run, or one of figures only, is left as it is.
 */
export function spokenDigitsAsFigures(text: string): string {
  return text.replace(RUN, (run) => {
    const { digits, spoken } = digitsOf(run);
    return spoken && digits.length >= SPOKEN_RUN_MIN_DIGITS ? digits : run;
  });
}
