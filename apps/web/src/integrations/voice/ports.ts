/**
 * The three steps of a spoken turn (BLUEPRINT §9.2): speech to text, a reply from the model, text
 * to speech. The voice worker (Phase 2, LiveKit Agents) streams all three; the spike times each
 * behind these interfaces so vendors can be swapped without touching the measurement.
 */

export interface Transcript {
  text: string;
  languageCode: string | undefined;
  ms: number;
}

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

export interface Reply {
  text: string;
  /** From the request to the first streamed text. */
  firstTokenMs: number;
  /** From the request to the end of the first sentence: what the voice can start speaking. */
  firstSentenceMs: number;
  firstSentence: string;
  totalMs: number;
}

export interface ReplyModel {
  readonly vendor: string;
  reply(system: string, userText: string): Promise<Reply>;
}
