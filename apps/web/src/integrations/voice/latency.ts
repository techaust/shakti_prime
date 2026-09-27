import type { ReplyModel, SpeechToText, TextToSpeech } from './ports';

/** The latency target for a spoken turn (BLUEPRINT §9.2): p50 below 1.5 s. */
export const FIRST_AUDIO_P50_TARGET_MS = 1_500;

export interface LatencySummary {
  n: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
}

/** Nearest-rank percentile. NaN for no samples. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? Number.NaN;
}

export function summarize(values: readonly number[]): LatencySummary {
  const round = (n: number) => Math.round(n);
  return {
    n: values.length,
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    min: values.length === 0 ? Number.NaN : round(Math.min(...values)),
    max: values.length === 0 ? Number.NaN : round(Math.max(...values)),
  };
}

export interface TurnTiming {
  sttMs: number;
  llmFirstTokenMs: number;
  llmFirstSentenceMs: number;
  llmTotalMs: number;
  ttsFirstSentenceMs: number;
  /**
   * What the speaker waits for in a streamed pipeline: the transcript, the model's first
   * sentence, and that sentence's audio. The measure the 1.5 s target applies to.
   */
  firstAudioMs: number;
  /** The same three steps run one after another on the whole reply. */
  sequentialMs: number;
}

export interface TurnResult {
  timing: TurnTiming;
  transcript: string;
  reply: string;
}

/**
 * One spoken turn through the three steps, timed. The speech-to-text call is timed on the whole
 * recording, as a batch call; a streaming recogniser finishes sooner after the speaker stops, so
 * `firstAudioMs` here is an upper bound.
 */
export async function runTurn(
  audio: Uint8Array,
  options: { mimeType: string; languageCode: string; system: string; speaker?: string },
  steps: { stt: SpeechToText; llm: ReplyModel; tts: TextToSpeech },
): Promise<TurnResult> {
  const transcript = await steps.stt.transcribe(audio, {
    mimeType: options.mimeType,
    languageCode: options.languageCode,
  });
  const reply = await steps.llm.reply(options.system, transcript.text);
  const firstSpeech = await steps.tts.synthesize(reply.firstSentence, {
    languageCode: options.languageCode,
    ...(options.speaker === undefined ? {} : { speaker: options.speaker }),
  });
  const rest = reply.text.slice(reply.firstSentence.length).trim();
  const restMs =
    rest === ''
      ? 0
      : (
          await steps.tts.synthesize(rest, {
            languageCode: options.languageCode,
            ...(options.speaker === undefined ? {} : { speaker: options.speaker }),
          })
        ).ms;
  return {
    transcript: transcript.text,
    reply: reply.text,
    timing: {
      sttMs: transcript.ms,
      llmFirstTokenMs: reply.firstTokenMs,
      llmFirstSentenceMs: reply.firstSentenceMs,
      llmTotalMs: reply.totalMs,
      ttsFirstSentenceMs: firstSpeech.ms,
      firstAudioMs: transcript.ms + reply.firstSentenceMs + firstSpeech.ms,
      sequentialMs: transcript.ms + reply.totalMs + firstSpeech.ms + restMs,
    },
  };
}
