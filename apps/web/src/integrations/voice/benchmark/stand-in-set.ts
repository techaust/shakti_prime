import type { KeyTerm, KeyTermKind, ListenerMark, SpeechPrice } from './measures';

/**
 * The stand-in set's files (docs/04-architecture-appendix/voice.md §5): `set.json` names each
 * recording with its reference transcript in Roman script and its key terms; `marks.json` holds
 * the listeners' on-topic marks. Recordings and marks stay outside the repository; speakers and
 * listeners are named by a label or a role, never by name. Both files are read as untrusted input.
 */

export type SpokenLanguage = 'hindi' | 'hinglish' | 'english';

export interface SetItem {
  id: string;
  /** The recording, a 16-bit PCM mono WAV beside `set.json`. */
  file: string;
  language: SpokenLanguage;
  /** A label such as `team-2`, never a name. */
  speaker: string;
  /** Marked when the speaker has one, so results can be read by accent. */
  accent?: string;
  /** What was said, in Roman script, written by the team. */
  reference: string;
  keyTerms: KeyTerm[];
  /** Where the speaker stops, in the recording's milliseconds; worked out from the audio if absent. */
  speechEndMs?: number;
  /** The recording's length; read from the WAV on a live run, required for a replay. */
  durationMs?: number;
}

export interface StandInSet {
  name: string;
  /** The language code sent to the vendors. */
  languageCode: string;
  items: SetItem[];
}

const LANGUAGES: readonly string[] = ['hindi', 'hinglish', 'english'];
const KINDS: readonly string[] = ['number', 'amount', 'unit', 'product', 'place'];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.wav$/;

function fail(where: string, what: string): never {
  throw new Error(`${where}: ${what}`);
}

function text(value: unknown, where: string, max = 1_000): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    fail(where, `a text of at most ${String(max)} characters is expected`);
  }
  return value;
}

function optionalMs(value: unknown, where: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 600_000) {
    fail(where, 'milliseconds between 0 and 600000 are expected');
  }
  return value;
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'an object is expected');
  }
  return value as Record<string, unknown>;
}

function keyTerm(value: unknown, where: string): KeyTerm {
  const raw = object(value, where);
  const kind = raw.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind))
    fail(where, `kind is one of ${KINDS.join(', ')}`);
  return { term: text(raw.term, `${where}.term`, 80), kind: kind as KeyTermKind };
}

/** Reads `set.json`; throws naming the first field that is wrong. */
export function parseStandInSet(json: unknown): StandInSet {
  const raw = object(json, 'set');
  if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > 200) {
    fail('set.items', 'between 1 and 200 items are expected');
  }
  const ids = new Set<string>();
  const items = raw.items.map((value: unknown, index): SetItem => {
    const where = `set.items[${String(index)}]`;
    const item = object(value, where);
    const id = text(item.id, `${where}.id`, 40);
    if (!ID.test(id)) fail(`${where}.id`, 'lower-case letters, digits and hyphens are expected');
    if (ids.has(id)) fail(`${where}.id`, 'ids are unique');
    ids.add(id);
    const file = text(item.file, `${where}.file`, 84);
    if (!FILE.test(file)) fail(`${where}.file`, 'a .wav file name without folders is expected');
    const language = item.language;
    if (typeof language !== 'string' || !LANGUAGES.includes(language)) {
      fail(`${where}.language`, `one of ${LANGUAGES.join(', ')} is expected`);
    }
    if (!Array.isArray(item.keyTerms) || item.keyTerms.length > 20) {
      fail(`${where}.keyTerms`, 'a list of at most 20 terms is expected');
    }
    const speechEndMs = optionalMs(item.speechEndMs, `${where}.speechEndMs`);
    const durationMs = optionalMs(item.durationMs, `${where}.durationMs`);
    return {
      id,
      file,
      language: language as SpokenLanguage,
      speaker: text(item.speaker, `${where}.speaker`, 40),
      ...(item.accent === undefined ? {} : { accent: text(item.accent, `${where}.accent`, 40) }),
      reference: text(item.reference, `${where}.reference`),
      keyTerms: item.keyTerms.map((term: unknown, t) =>
        keyTerm(term, `${where}.keyTerms[${String(t)}]`),
      ),
      ...(speechEndMs === undefined ? {} : { speechEndMs }),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  });
  return {
    name: text(raw.name, 'set.name', 80),
    languageCode: text(raw.languageCode, 'set.languageCode', 10),
    items,
  };
}

/** Reads `marks.json`: a list of `{ item, listener, onTopic }`. */
export function parseMarks(json: unknown, set: StandInSet): ListenerMark[] {
  if (!Array.isArray(json)) fail('marks', 'a list is expected');
  const ids = new Set(set.items.map((item) => item.id));
  return json.map((value: unknown, index): ListenerMark => {
    const where = `marks[${String(index)}]`;
    const mark = object(value, where);
    const item = text(mark.item, `${where}.item`, 40);
    if (!ids.has(item)) fail(`${where}.item`, 'an id of the set is expected');
    if (typeof mark.onTopic !== 'boolean') fail(`${where}.onTopic`, 'true or false is expected');
    return { item, listener: text(mark.listener, `${where}.listener`, 40), onTopic: mark.onTopic };
  });
}

/**
 * Sarvam AI's published prices, as read on 13-11-2026 through search results quoting its pricing
 * page (sarvam.ai/api-pricing could not be opened from the build session): speech to text ₹30 an
 * hour, Bulbul v2 speech ₹15 per 10,000 characters. Confirmed on the page before part 2's run.
 */
export const SARVAM_PRICE: SpeechPrice = {
  vendor: 'sarvam',
  sttRupeesPerHour: 30,
  ttsRupeesPer10kCharacters: 15,
  checkedOn: '2026-11-13',
  source: 'sarvam.ai/api-pricing, quoted by search results; to confirm on the page',
};
