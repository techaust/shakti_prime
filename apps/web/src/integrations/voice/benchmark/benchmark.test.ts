import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasDevanagari } from '../roman-script';
import { readRecordedTurns, readSetFolder } from './files';
import {
  characterErrorRate,
  characterErrors,
  costPerMinute,
  editDistance,
  keyTermsFound,
  onTopicTurns,
  speechCost,
  stepSummary,
} from './measures';
import { normalise, numbersAsDigits } from './normalise';
import { replayBenchmark } from './replay';
import { parseMarks, parseStandInSet, SARVAM_PRICE } from './stand-in-set';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, 'fixtures');

describe('normalising a transcript', () => {
  it('lower-cases, folds spellings and spelled letters, and drops marks', () => {
    expect(normalise('Paanch H.P. ka Submersable pump?')).toBe('5 hp ka submersible pump');
    expect(normalise('Model S-S-P 75, on grid')).toBe('model ssp 75 ongrid');
    expect(normalise('panch horse power')).toBe('5 hp');
  });

  it('writes numbers as digits, in Hindi, English and Indian grouping', () => {
    const cases: [string, string][] = [
      ['ek lakh pachchees hazaar rupaye', '125000 rupaye'],
      ['₹1,25,000', 'rupaye 125000'],
      ['dhaai lakh', '250000'],
      ['saadhe teen hazaar', '3500'],
      ['sawa do', '2.25'],
      ['paune do sau', '175'],
      ['dedh', '1.5'],
      ['2.5 crore', '25000000'],
      ['teen sau saath feet', '360 feet'],
      ['do sau do', '202'],
      ['one hundred twenty five', '125'],
      ['forty two', '42'],
      ['twenty twenty', '20 20'],
      ['do paanch', '2 5'],
      ['sau', '100'],
      ['saadhe', 'saadhe'],
      ['5 HP', '5 hp'],
    ];
    for (const [text, expected] of cases) expect(normalise(text), text).toBe(expected);
    expect(numbersAsDigits(['order', 'nau'])).toEqual(['order', '9']);
  });
});

describe('the measures', () => {
  it('counts character edits', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
    // "me" for "mein": two characters missing out of the normalised reference's 23.
    expect(characterErrors('Pump stock mein hai kya?', 'pump stock me hai kya')).toEqual({
      edits: 2,
      length: 23,
    });
  });

  it('weighs the set error rate by reference length', () => {
    expect(
      characterErrorRate([
        { edits: 1, length: 10 },
        { edits: 9, length: 90 },
      ]),
    ).toBe(0.1);
    expect(Number.isNaN(characterErrorRate([]))).toBe(true);
  });

  it('finds key terms as whole normalised words', () => {
    const terms = [
      { term: '5 HP', kind: 'unit' as const },
      { term: '1,25,000', kind: 'amount' as const },
      { term: 'Jodhpur', kind: 'place' as const },
    ];
    expect(keyTermsFound('paanch hp ka pump, ek lakh pachchees hazaar mein', terms)).toEqual([
      true,
      true,
      false,
    ]);
    // "15 hp" does not hold "5 hp".
    expect(keyTermsFound('pandrah hp', terms)[0]).toBe(false);
  });

  it('takes the majority of the listeners, a tie counting as off topic', () => {
    const marks = [
      { item: 'a', listener: 'executive', onTopic: true },
      { item: 'a', listener: 'tele-caller', onTopic: true },
      { item: 'a', listener: 'field engineer', onTopic: false },
      { item: 'b', listener: 'executive', onTopic: true },
      { item: 'b', listener: 'tele-caller', onTopic: false },
    ];
    expect(Object.fromEntries(onTopicTurns(marks))).toEqual({ a: true, b: false });
  });

  it('summarises a step against its budget', () => {
    expect(stepSummary([250, 280, 260], 250)).toEqual({
      n: 3,
      p50: 260,
      p95: 280,
      budgetMs: 250,
      met: false,
    });
    expect(stepSummary([], 250)).toEqual({ n: 0, p50: null, p95: null, budgetMs: 250, met: null });
  });

  it('prices speech by the hour and by characters, and a minute of it', () => {
    // An hour of audio at ₹30 is 3,000 paise; 10,000 characters at ₹15 is 1,500 paise.
    expect(speechCost(SARVAM_PRICE, 3_600_000, 10_000)).toEqual({
      sttPaise: 3_000,
      ttsPaise: 1_500,
    });
    expect(
      costPerMinute(
        [
          { sttPaise: 50, ttsPaise: 10, modelPaise: 5 },
          { sttPaise: 50, ttsPaise: 20, modelPaise: 5 },
        ],
        120_000,
      ),
    ).toEqual({
      audioMinutes: 2,
      paisePerMinute: 70,
      sttPaisePerMinute: 50,
      ttsPaisePerMinute: 15,
      modelPaisePerMinute: 5,
    });
  });
});

describe('reading a set', () => {
  it('names the field that is wrong', () => {
    const item = {
      id: 'q01',
      file: 'q01.wav',
      language: 'hinglish',
      speaker: 'team-1',
      reference: 'pump',
      keyTerms: [],
    };
    expect(() => parseStandInSet({ name: 's', languageCode: 'hi-IN', items: [] })).toThrow(
      'set.items',
    );
    expect(() =>
      parseStandInSet({
        name: 's',
        languageCode: 'hi-IN',
        items: [{ ...item, file: '../q01.wav' }],
      }),
    ).toThrow('set.items[0].file');
    expect(() =>
      parseStandInSet({ name: 's', languageCode: 'hi-IN', items: [item, item] }),
    ).toThrow('ids are unique');
    const set = parseStandInSet({ name: 's', languageCode: 'hi-IN', items: [item] });
    expect(() => parseMarks([{ item: 'q09', listener: 'executive', onTopic: true }], set)).toThrow(
      'marks[0].item',
    );
  });
});

describe('the benchmark on the fixture set', () => {
  it('reproduces its numbers from the recorded sessions', async () => {
    const { set, marks } = readSetFolder(FIXTURES);
    const turns = readRecordedTurns(set, join(FIXTURES, 'turns'));
    const report = await replayBenchmark({ set, turns, marks, speechPrice: SARVAM_PRICE });
    const expected: unknown = JSON.parse(readFileSync(join(FIXTURES, 'report.json'), 'utf8'));
    expect(report).toEqual(expected);

    // The numbers worked out by hand from the fixtures (voice.md §5).
    expect(report.failed).toBe(1);
    // q01 misses 2 of its 43 characters, q05 failed and misses all 22; 219 in all.
    expect(report.accuracy.characterErrorRate).toBe(Math.round((24 / 219) * 10_000) / 10_000);
    // ₹30 an hour is 50 paise a minute.
    expect(report.cost.sttPaisePerMinute).toBe(50);
    expect(report.accuracy.keyTerms).toMatchObject({ found: 7, total: 8, share: 0.875 });
    expect(report.accuracy.onTopic).toEqual({ marked: 4, onTopic: 3, share: 0.75 });
    expect(report.latency.endOfSpeech).toMatchObject({ n: 3, p50: 260, met: false });
    expect(report.latency.firstSentence).toMatchObject({ n: 4, p50: 560, p95: 640, met: true });
    expect(report.latency.firstAudio).toMatchObject({ n: 4, p50: 1_420, p95: 1_550, met: true });
    expect(report.latency.missedSteps).toEqual(['endOfSpeech']);
    expect(report.perItem.find((i) => i.id === 'q05')).toMatchObject({
      failure: 'sarvam http rate_limit_exceeded_error',
      keyTerms: '0/1',
      firstAudioMs: null,
    });
  });

  it('holds no Devanagari in the voice code, its fixtures or its report (ADR 0014)', () => {
    const voice = dirname(here);
    const files = readdirSync(voice, { recursive: true, encoding: 'utf8' }).filter((f) =>
      /\.(ts|json)$/.test(f),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(hasDevanagari(readFileSync(join(voice, file), 'utf8')), file).toBe(false);
    }
  });
});
