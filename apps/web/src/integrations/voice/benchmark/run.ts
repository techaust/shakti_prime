import { costInPaise } from '@shakti/domain';
import { ProviderError } from '../../http';
import type {
  Clock,
  ReplyModel,
  ReplyUsage,
  StreamingSpeechToText,
  StreamingTextToSpeech,
} from '../ports';
import type { PcmAudio } from '../recording';
import {
  ACCURACY_TARGET,
  characterErrorRate,
  characterErrors,
  costPerMinute,
  keyTermsFound,
  LATENCY_BUDGET_MS,
  onTopicTurns,
  speechCost,
  stepSummary,
  type KeyTermKind,
  type ListenerMark,
  type SpeechPrice,
  type TurnCost,
} from './measures';
import type { SetItem, StandInSet } from './stand-in-set';

/**
 * The benchmark run (docs/03-roadmap-appendix/phase2.md §5.3): each recording of a set streams to
 * the speech-to-text vendor at its own pace, its transcript goes to the voice model, and the
 * reply's first sentence to the speech vendor; each step is timed against §9.3, the transcript is
 * scored against its reference, and the cost is counted from the published prices. The same code
 * runs on live vendors and on recorded sessions (`recorded.ts`); only the steps and the pacing
 * differ. Transcripts and replies are held in memory to score them and never written out.
 */

/** The spoken-reply instruction the benchmark and the latency spike time; V2's prompt replaces it. */
export const SPOKEN_REPLY_SYSTEM = [
  'You are the voice assistant of the Shakti group, which sells pumps, solar systems and',
  'agricultural equipment in India. The person speaking is a Shakti executive.',
  'Reply in one or two short spoken sentences in Roman-script Hinglish, the way a helpful',
  'colleague talks on the phone. No lists, no symbols, no markdown.',
].join(' ');

export interface TurnSteps {
  stt: StreamingSpeechToText;
  llm: ReplyModel;
  tts: StreamingTextToSpeech;
  clock: Clock;
}

export interface TurnAudio {
  sampleRate: number;
  /** 16-bit little-endian PCM, mono, in pieces of `chunkMs`. */
  chunks: Uint8Array[];
  chunkMs: number;
  durationMs: number;
  /** Where the speaker stops, from the start of the recording. */
  speechEndMs: number;
}

export interface TurnTiming {
  /** From the speaker stopping to the recogniser saying so; absent when it sent no signal. */
  endOfSpeechMs?: number;
  /** From that signal to the settled transcript. */
  finalTranscriptMs?: number;
  /** From the speaker stopping to the settled transcript: the two steps above together. */
  afterSpeechMs: number;
  firstSentenceMs: number;
  firstSpeechMs: number;
  /** The four measured steps and the budgeted network and playback time (§9.3). */
  firstAudioMs: number;
}

export interface TurnObservation {
  id: string;
  /** Scored, never written out; empty when speech to text failed. */
  transcript: string;
  replyCharacters: number;
  usage?: ReplyUsage;
  timing?: TurnTiming;
  /** The step that failed and how, as the provider error names it (no text from the turn). */
  failure?: string;
}

/** Splits mono PCM into `chunkMs` pieces of little-endian bytes, as a microphone would send them. */
export function pcmChunks(audio: PcmAudio, chunkMs = 100): Uint8Array[] {
  if (audio.channels !== 1) throw new Error('the benchmark streams mono recordings only');
  const perChunk = Math.max(1, Math.round((audio.sampleRate * chunkMs) / 1000));
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < audio.samples.length; start += perChunk) {
    const piece = audio.samples.subarray(start, start + perChunk);
    const bytes = new Uint8Array(piece.length * 2);
    const view = new DataView(bytes.buffer);
    piece.forEach((sample, i) => {
      view.setInt16(i * 2, sample, true);
    });
    chunks.push(bytes);
  }
  return chunks;
}

/**
 * What failed, for the report: a provider error by its provider, kind and code; anything else as
 * `unexpected`, without its message, which could quote a transcript or a reply.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof ProviderError)) return 'unexpected';
  return [error.provider, error.failure, error.vendorCode].filter((p) => p !== undefined).join(' ');
}

/**
 * When a chunk goes to the vendor. A live run waits until `atMs` (absolute times, so the timers'
 * lateness never adds up) and answers when the chunk was really sent; a replay moves its clock to
 * `atMs` and answers it.
 */
export type Pace = (atMs: number) => Promise<number>;

/** The steps a turn can fail in, named in `failure`. */
type Step = 'speech to text' | 'reply' | 'speech';

/**
 * One spoken turn, timed per step. Audio goes out as a microphone sends it, each chunk once its
 * time has passed. A vendor failure is recorded on the turn, naming its step, with what the steps
 * before it produced (the transcript, the reply's tokens), so accuracy is still scored and the
 * tokens still counted.
 */
export async function observeTurn(
  item: SetItem,
  audio: TurnAudio,
  steps: TurnSteps,
  options: { languageCode: string; pace: Pace },
): Promise<TurnObservation> {
  const { clock } = steps;
  let step: Step = 'speech to text';
  let transcript = '';
  let replyCharacters = 0;
  let usage: ReplyUsage | undefined;
  const failed = (failure: string): TurnObservation => ({
    id: item.id,
    transcript,
    replyCharacters,
    ...(usage === undefined ? {} : { usage }),
    failure: `${step}: ${failure}`,
  });
  try {
    const stream = await steps.stt.open({
      languageCode: options.languageCode,
      sampleRate: audio.sampleRate,
    });
    const startedAt = clock.now();
    // The chunk that holds the speaker's stop, and when it was really sent.
    const stopChunk = Math.min(
      audio.chunks.length - 1,
      Math.floor(audio.speechEndMs / audio.chunkMs),
    );
    let stopChunkSentAt: number | undefined;
    // Set once the turn is over, so a recogniser that failed early is not fed the rest.
    let stopped = false;
    const send = async () => {
      for (const [i, chunk] of audio.chunks.entries()) {
        const sentAt = await options.pace(startedAt + (i + 1) * audio.chunkMs);
        if (stopped) return;
        stream.send(chunk);
        if (i === stopChunk) stopChunkSentAt = sentAt;
      }
      stream.end();
    };
    const finals: { text: string; atMs: number }[] = [];
    let speechEndAt: number | undefined;
    const listen = async () => {
      for await (const event of stream.events) {
        if (event.type === 'speech_end') speechEndAt = event.atMs;
        else if (event.type === 'final') finals.push({ text: event.text, atMs: event.atMs });
      }
    };
    try {
      await Promise.all([send(), listen()]);
    } finally {
      stopped = true;
      stream.close();
    }
    const last = finals.at(-1);
    if (last === undefined || stopChunkSentAt === undefined) return failed('no transcript');
    transcript = finals.map((f) => f.text.trim()).join(' ');
    // The stop happened before its chunk's end by this much; the chunk's own lateness is left out.
    const spokeUntil = stopChunkSentAt - ((stopChunk + 1) * audio.chunkMs - audio.speechEndMs);

    step = 'reply';
    const reply = await steps.llm.reply(SPOKEN_REPLY_SYSTEM, transcript);
    replyCharacters = reply.text.length;
    usage = reply.usage;

    step = 'speech';
    const speech = await steps.tts.open({ languageCode: options.languageCode });
    let firstChunkAt: number | undefined;
    const speakFrom = clock.now();
    try {
      for await (const chunk of speech.speak(reply.firstSentence)) firstChunkAt ??= chunk.atMs;
    } finally {
      speech.close();
    }
    if (firstChunkAt === undefined) return failed('no audio');
    const afterSpeechMs = last.atMs - spokeUntil;
    const firstSpeechMs = firstChunkAt - speakFrom;
    return {
      id: item.id,
      transcript,
      replyCharacters,
      usage,
      timing: {
        ...(speechEndAt === undefined
          ? {}
          : {
              endOfSpeechMs: speechEndAt - spokeUntil,
              finalTranscriptMs: last.atMs - speechEndAt,
            }),
        afterSpeechMs,
        firstSentenceMs: reply.firstSentenceMs,
        firstSpeechMs,
        firstAudioMs:
          afterSpeechMs +
          reply.firstSentenceMs +
          firstSpeechMs +
          LATENCY_BUDGET_MS.networkAndPlayback,
      },
    };
  } catch (error) {
    return failed(describeFailure(error));
  }
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const share = (found: number, total: number) => (total === 0 ? null : round4(found / total));

export interface BenchmarkInput {
  set: StandInSet;
  observations: readonly TurnObservation[];
  /** Each item's recording length, for the speech-to-text cost and the cost per minute. */
  durationsMs: ReadonlyMap<string, number>;
  marks: readonly ListenerMark[];
  vendors: { speechToText: string; reply: string; speech: string };
  speechPrice: SpeechPrice;
  replyModel: string;
}

/** Scores a run: accuracy against the references, step times against §9.3, cost per minute. */
export function scoreBenchmark(input: BenchmarkInput) {
  const byId = new Map(input.observations.map((o) => [o.id, o]));
  const onTopic = onTopicTurns(input.marks);
  const errors = [];
  const kinds = new Map<KeyTermKind, { found: number; total: number }>();
  let termsFound = 0;
  let termsTotal = 0;
  const costs: TurnCost[] = [];
  let audioMs = 0;
  const perItem = [];

  for (const item of input.set.items) {
    const observation = byId.get(item.id);
    if (observation === undefined) throw new Error(`no observation for ${item.id}`);
    // A failed turn heard nothing: every reference character and key term counts as missed.
    const errorsOfItem = characterErrors(item.reference, observation.transcript);
    errors.push(errorsOfItem);
    const found = keyTermsFound(observation.transcript, item.keyTerms);
    item.keyTerms.forEach((term, i) => {
      const entry = kinds.get(term.kind) ?? { found: 0, total: 0 };
      entry.total += 1;
      if (found[i] === true) entry.found += 1;
      kinds.set(term.kind, entry);
    });
    const foundCount = found.filter(Boolean).length;
    termsFound += foundCount;
    termsTotal += item.keyTerms.length;

    const durationMs = input.durationsMs.get(item.id) ?? 0;
    audioMs += durationMs;
    costs.push({
      ...speechCost(input.speechPrice, durationMs, observation.replyCharacters),
      modelPaise:
        observation.usage === undefined ? 0 : costInPaise(input.replyModel, observation.usage),
    });
    perItem.push({
      id: item.id,
      language: item.language,
      ...(item.accent === undefined ? {} : { accent: item.accent }),
      characterErrorRate: round4(characterErrorRate([errorsOfItem])),
      keyTerms: `${String(foundCount)}/${String(item.keyTerms.length)}`,
      onTopic: onTopic.get(item.id) ?? null,
      firstAudioMs:
        observation.timing === undefined ? null : Math.round(observation.timing.firstAudioMs),
      ...(observation.failure === undefined ? {} : { failure: observation.failure }),
    });
  }

  const timings = input.observations.flatMap((o) => (o.timing === undefined ? [] : [o.timing]));
  const pick = (read: (t: TurnTiming) => number | undefined) =>
    timings.flatMap((t) => {
      const value = read(t);
      return value === undefined ? [] : [value];
    });
  const latency = {
    endOfSpeech: stepSummary(
      pick((t) => t.endOfSpeechMs),
      LATENCY_BUDGET_MS.endOfSpeech,
    ),
    finalTranscript: stepSummary(
      pick((t) => t.finalTranscriptMs),
      LATENCY_BUDGET_MS.finalTranscript,
    ),
    firstSentence: stepSummary(
      pick((t) => t.firstSentenceMs),
      LATENCY_BUDGET_MS.firstSentence,
    ),
    firstSpeech: stepSummary(
      pick((t) => t.firstSpeechMs),
      LATENCY_BUDGET_MS.firstSpeech,
    ),
    firstAudio: stepSummary(
      pick((t) => t.firstAudioMs),
      LATENCY_BUDGET_MS.firstAudio,
    ),
  };
  const missedSteps = Object.entries(latency)
    .filter(([, summary]) => summary.met === false)
    .map(([step]) => step);

  const cer = characterErrorRate(errors);
  const termShare = share(termsFound, termsTotal);
  const marked = input.set.items.filter((item) => onTopic.has(item.id));
  const onTopicCount = marked.filter((item) => onTopic.get(item.id) === true).length;
  const onTopicShare = share(onTopicCount, marked.length);

  return {
    set: input.set.name,
    items: input.set.items.length,
    failed: input.observations.filter((o) => o.failure !== undefined).length,
    vendors: input.vendors,
    accuracy: {
      characterErrorRate: round4(cer),
      keyTerms: {
        found: termsFound,
        total: termsTotal,
        share: termShare,
        byKind: Object.fromEntries([...kinds].sort(([a], [b]) => a.localeCompare(b))),
      },
      onTopic: { marked: marked.length, onTopic: onTopicCount, share: onTopicShare },
    },
    latency: {
      ...latency,
      networkAndPlaybackBudgetedMs: LATENCY_BUDGET_MS.networkAndPlayback,
      missedSteps,
    },
    cost: {
      ...costPerMinute(costs, audioMs),
      speechPricesCheckedOn: input.speechPrice.checkedOn,
    },
    targets: {
      characterErrorRate: {
        target: ACCURACY_TARGET.maxCharacterErrorRate,
        met: Number.isNaN(cer) ? null : cer <= ACCURACY_TARGET.maxCharacterErrorRate,
      },
      keyTerms: {
        target: ACCURACY_TARGET.minKeyTermShare,
        met: termShare === null ? null : termShare >= ACCURACY_TARGET.minKeyTermShare,
      },
      onTopic: {
        target: ACCURACY_TARGET.minOnTopicShare,
        met: onTopicShare === null ? null : onTopicShare >= ACCURACY_TARGET.minOnTopicShare,
      },
    },
    perItem,
  };
}

export type BenchmarkReport = ReturnType<typeof scoreBenchmark>;
