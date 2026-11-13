import { percentile } from '../latency';
import { normalise } from './normalise';

/**
 * The benchmark's measures (docs/03-roadmap-appendix/phase2.md §5.3, §9.2 and §9.3), as pure
 * functions: character error rate after normalisation, key-term accuracy, the listeners' on-topic
 * marks, each step's time against its budget, and the cost of a minute of speech.
 */

/**
 * The speech-to-text target the owner decided on 13-11-2026 (question 6 (a), DECISIONS): measured
 * on the stand-in set now and confirmed on the client's samples in the final phase.
 */
export const ACCURACY_TARGET = {
  /** Character error rate on normalised Roman-script transcripts, at most. */
  maxCharacterErrorRate: 0.12,
  /** Key terms right, at least. */
  minKeyTermShare: 0.95,
  /** Turns the listeners mark on topic, at least. */
  minOnTopicShare: 0.9,
} as const;

/** The p50 budget of each step of a spoken turn from Mumbai (§9.3), in milliseconds. */
export const LATENCY_BUDGET_MS = {
  endOfSpeech: 250,
  finalTranscript: 250,
  firstSentence: 600,
  firstSpeech: 250,
  networkAndPlayback: 150,
  firstAudio: 1_500,
} as const;

/** Edits (insertions, deletions, substitutions) that turn `from` into `to`, by code point. */
export function editDistance(from: string, to: string): number {
  const a = Array.from(from);
  const b = Array.from(to);
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, substitution));
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

export interface CharacterErrors {
  edits: number;
  /** Characters of the normalised reference. */
  length: number;
}

/** The character errors of one transcript against its reference, both normalised. */
export function characterErrors(reference: string, transcript: string): CharacterErrors {
  const ref = normalise(reference);
  return { edits: editDistance(ref, normalise(transcript)), length: Array.from(ref).length };
}

/** The set's rate: every edit over every reference character, so long questions weigh more. */
export function characterErrorRate(items: readonly CharacterErrors[]): number {
  const length = items.reduce((sum, item) => sum + item.length, 0);
  if (length === 0) return Number.NaN;
  return items.reduce((sum, item) => sum + item.edits, 0) / length;
}

export type KeyTermKind = 'number' | 'amount' | 'unit' | 'product' | 'place';

export interface KeyTerm {
  term: string;
  kind: KeyTermKind;
}

/** Which key terms the transcript holds, each normalised and matched as whole words. */
export function keyTermsFound(transcript: string, terms: readonly KeyTerm[]): boolean[] {
  const said = ` ${normalise(transcript)} `;
  return terms.map((term) => {
    const wanted = normalise(term.term);
    return wanted !== '' && said.includes(` ${wanted} `);
  });
}

export interface ListenerMark {
  item: string;
  /** The listener's role (tele-caller, executive, field engineer), never a name. */
  listener: string;
  onTopic: boolean;
}

/** A turn is on topic when more than half of its listeners mark it so. */
export function onTopicTurns(marks: readonly ListenerMark[]): Map<string, boolean> {
  const tally = new Map<string, { yes: number; all: number }>();
  for (const mark of marks) {
    const entry = tally.get(mark.item) ?? { yes: 0, all: 0 };
    entry.all += 1;
    if (mark.onTopic) entry.yes += 1;
    tally.set(mark.item, entry);
  }
  return new Map([...tally].map(([item, { yes, all }]) => [item, yes * 2 > all]));
}

export interface StepSummary {
  n: number;
  p50: number | null;
  p95: number | null;
  budgetMs: number;
  /** The p50 within the budget; null with no samples. */
  met: boolean | null;
}

/** p50 and p95 (nearest rank) of a step's samples against its budget. */
export function stepSummary(values: readonly number[], budgetMs: number): StepSummary {
  if (values.length === 0) return { n: 0, p50: null, p95: null, budgetMs, met: null };
  const p50 = Math.round(percentile(values, 50));
  return {
    n: values.length,
    p50,
    p95: Math.round(percentile(values, 95)),
    budgetMs,
    met: p50 <= budgetMs,
  };
}

/** A speech vendor's published prices, in rupees, with the date they were read. */
export interface SpeechPrice {
  vendor: string;
  sttRupeesPerHour: number;
  ttsRupeesPer10kCharacters: number;
  checkedOn: string;
  source: string;
}

/** What one turn cost, in paise, not yet rounded. */
export interface TurnCost {
  sttPaise: number;
  ttsPaise: number;
  modelPaise: number;
}

/** Speech to text on the audio sent, speech on every character of the reply. */
export function speechCost(price: SpeechPrice, audioMs: number, replyCharacters: number) {
  return {
    sttPaise: (audioMs / 3_600_000) * price.sttRupeesPerHour * 100,
    ttsPaise: (replyCharacters / 10_000) * price.ttsRupeesPer10kCharacters * 100,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Paise per minute of the speakers' audio, in all and by step. */
export function costPerMinute(costs: readonly TurnCost[], audioMs: number) {
  const minutes = audioMs / 60_000;
  const sum = (key: keyof TurnCost) => costs.reduce((total, cost) => total + cost[key], 0);
  const per = (paise: number) => (minutes === 0 ? Number.NaN : round2(paise / minutes));
  const stt = sum('sttPaise');
  const tts = sum('ttsPaise');
  const model = sum('modelPaise');
  return {
    audioMinutes: round2(minutes),
    paisePerMinute: per(stt + tts + model),
    sttPaisePerMinute: per(stt),
    ttsPaisePerMinute: per(tts),
    modelPaisePerMinute: per(model),
  };
}
