/**
 * The three steps of a spoken turn (BLUEPRINT §9.2): speech to text, a reply from the model, text
 * to speech. The voice worker (Phase 2, LiveKit Agents) streams all three; the spike and the
 * benchmark (docs/03-roadmap-appendix/phase2.md §5.3) time each behind these interfaces so vendors
 * can be swapped without touching the measurement.
 *
 * Every transcript an adapter answers is in Roman script: an adapter refuses a transcript in
 * Devanagari rather than pass it on (ADR 0014, `roman-script.ts`). An adapter may turn a Hinglish
 * line into Devanagari inside itself for the vendor's pronunciation; that text is never answered,
 * shown, stored or logged.
 *
 * Whole recordings (call recordings for A2, vault audio for K3) go through `transcribeRecording()`
 * in `recording.ts`, which cuts them into pieces the batch `SpeechToText` accepts.
 */

/** Milliseconds from a fixed start. Live runs use `performance.now()`; replays drive their own. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => performance.now() };

export interface Transcript {
  text: string;
  languageCode: string | undefined;
  ms: number;
}

/** Batch speech to text: one short recording (the vendor's limit, about 30 seconds) per call. */
export interface SpeechToText {
  readonly vendor: string;
  transcribe(
    audio: Uint8Array,
    options: { mimeType: string; languageCode: string },
  ): Promise<Transcript>;
}

export interface Speech {
  audio: Uint8Array;
  mimeType: string;
  ms: number;
}

export interface TextToSpeech {
  readonly vendor: string;
  synthesize(text: string, options: { languageCode: string; speaker?: string }): Promise<Speech>;
}

/** What a streaming recogniser reports, each at the clock time it arrived. */
export type SttEvent =
  | { type: 'speech_start'; atMs: number }
  /** The recogniser decided the speaker stopped (its voice activity detection). */
  | { type: 'speech_end'; atMs: number }
  /** A transcript that may still change; not every vendor or endpoint sends them. */
  | { type: 'partial'; text: string; atMs: number }
  /** A settled transcript of what was said since the last one. */
  | { type: 'final'; text: string; languageCode: string | undefined; atMs: number };

export interface SttStream {
  /** Audio as it is captured: 16-bit little-endian PCM, mono, at the opened sample rate. */
  send(audio: Uint8Array): void;
  /** No more audio: the vendor settles what it heard, then `events` ends. */
  end(): void;
  /** Stops at once, without waiting for the vendor. */
  close(): void;
  /** Read once; ends after `end()` is answered or the vendor closes, throws on a vendor error. */
  readonly events: AsyncIterable<SttEvent>;
}

export interface StreamingSpeechToText {
  readonly vendor: string;
  open(options: { languageCode: string; sampleRate: number }): Promise<SttStream>;
}

export interface SpeechChunk {
  audio: Uint8Array;
  mimeType: string;
  /** Clock time the chunk arrived; the first chunk's time, less the `speak()` call's, times the step. */
  atMs: number;
}

export interface TtsStream {
  /** Speaks one piece of text (a sentence), yielding its audio as it comes, then ends. */
  speak(text: string): AsyncIterable<SpeechChunk>;
  close(): void;
}

/** Opened before the reply is ready, so a sentence's first audio does not wait for a connection. */
export interface StreamingTextToSpeech {
  readonly vendor: string;
  open(options: { languageCode: string; speaker?: string }): Promise<TtsStream>;
}

/** Tokens a reply used, as the Messages API reports them, for its cost. */
export interface ReplyUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Reply {
  text: string;
  /** From the request to the first streamed text. */
  firstTokenMs: number;
  /** From the request to the end of the first sentence: what the voice can start speaking. */
  firstSentenceMs: number;
  firstSentence: string;
  totalMs: number;
  usage: ReplyUsage;
}

export interface ReplyModel {
  readonly vendor: string;
  /** The model's id, for its price. */
  readonly model: string;
  reply(system: string, userText: string): Promise<Reply>;
}
