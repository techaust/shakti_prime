import type { SpeechToText, Transcript } from './ports';

/**
 * Whole recordings: a call recording (A2) or a voice note in the vault (K3) is minutes long, and a
 * batch speech-to-text call takes about 30 seconds of audio. `transcribeRecording()` cuts a WAV
 * into pieces under the limit, each cut at the quietest moment near its end so no word is split,
 * and joins the pieces' transcripts. It works with any `SpeechToText` adapter.
 *
 * Only 16-bit PCM WAV is read: a recording in another format is converted when it is
 * copied in (T3, K3), not here.
 */

export interface PcmAudio {
  sampleRate: number;
  channels: number;
  /** Interleaved samples. */
  samples: Int16Array;
}

export const WAV_MIME_TYPES: readonly string[] = ['audio/wav', 'audio/x-wav', 'audio/wave'];

/** Pieces stay under the vendor's 30-second limit with room to spare. */
export const MAX_PIECE_MS = 25_000;
/** How far back from a piece's longest end the quietest moment is looked for. */
export const CUT_SEARCH_MS = 5_000;
const FRAME_MS = 20;

function ascii(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

/** The sample rates and channel counts a recording may have; anything else is refused. */
export const MIN_SAMPLE_RATE = 8_000;
export const MAX_SAMPLE_RATE = 48_000;
export const MAX_CHANNELS = 2;

/**
 * Refuses a recording whose shape would break the cutting: no channels (the frames would never
 * move), or a rate under 8 kHz (a 20 ms frame shrinks to a sample and a file into thousands of
 * paid pieces).
 */
export function assertPlayable(audio: Pick<PcmAudio, 'channels' | 'sampleRate'>): void {
  if (!Number.isInteger(audio.channels) || audio.channels < 1 || audio.channels > MAX_CHANNELS) {
    throw new Error('a WAV of one or two channels is read');
  }
  if (
    !Number.isInteger(audio.sampleRate) ||
    audio.sampleRate < MIN_SAMPLE_RATE ||
    audio.sampleRate > MAX_SAMPLE_RATE
  ) {
    throw new Error('a WAV sampled at 8 to 48 kHz is read');
  }
}

/** Reads a 16-bit PCM WAV; throws for anything else, a header out of range or no audio. */
export function readWav(bytes: Uint8Array): PcmAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let format: { channels: number; sampleRate: number } | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) throw new Error('WAV format chunk too short');
      const audioFormat = view.getUint16(body, true);
      const bits = view.getUint16(body + 14, true);
      if (audioFormat !== 1 || bits !== 16) throw new Error('only 16-bit PCM WAV is read');
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      assertPlayable({ channels, sampleRate });
      if (view.getUint16(body + 12, true) !== channels * 2) {
        throw new Error('WAV block size does not match its channels');
      }
      format = { channels, sampleRate };
    } else if (id === 'data') {
      if (format === undefined) throw new Error('WAV data before its format');
      const frameBytes = format.channels * 2;
      const available = Math.min(size, bytes.length - body);
      const length = available - (available % frameBytes);
      if (length === 0) throw new Error('WAV without audio');
      const samples = new Int16Array(length / 2);
      for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(body + i * 2, true);
      return { ...format, samples };
    }
    // Chunks are padded to an even length.
    offset = body + size + (size % 2);
  }
  throw new Error('WAV without data');
}

/** Writes 16-bit PCM samples as a WAV. */
export function writeWav(audio: PcmAudio): Uint8Array {
  const dataBytes = audio.samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < 4; i += 1) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, audio.channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * audio.channels * 2, true);
  view.setUint16(32, audio.channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < audio.samples.length; i += 1) {
    view.setInt16(44 + i * 2, audio.samples[i] ?? 0, true);
  }
  return bytes;
}

export function durationMs(audio: PcmAudio): number {
  return (audio.samples.length / audio.channels / audio.sampleRate) * 1000;
}

/** Root-mean-square loudness of each 20 ms frame, channels together. */
function frameLoudness(audio: PcmAudio): { frameSamples: number; loudness: number[] } {
  assertPlayable(audio);
  const frameSamples =
    Math.max(1, Math.round((audio.sampleRate * FRAME_MS) / 1000)) * audio.channels;
  const loudness: number[] = [];
  for (let start = 0; start < audio.samples.length; start += frameSamples) {
    const end = Math.min(audio.samples.length, start + frameSamples);
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      const sample = audio.samples[i] ?? 0;
      sum += sample * sample;
    }
    loudness.push(Math.sqrt(sum / (end - start)));
  }
  return { frameSamples, loudness };
}

/**
 * Where the speaker stops: the end of the last 20 ms frame louder than a tenth of the loudest
 * frame (and than a floor for near-silent files). Undefined for a silent recording. The benchmark
 * uses it when a set's manifest does not mark the moment by hand.
 */
export function speechEndMs(audio: PcmAudio): number | undefined {
  const { loudness } = frameLoudness(audio);
  const loudest = Math.max(0, ...loudness);
  const threshold = Math.max(300, loudest / 10);
  for (let frame = loudness.length - 1; frame >= 0; frame -= 1) {
    if ((loudness[frame] ?? 0) >= threshold) {
      return Math.min(durationMs(audio), (frame + 1) * FRAME_MS);
    }
  }
  return undefined;
}

/**
 * Sample indexes where a recording is cut: each piece at most `maxPieceMs`, ending at the quietest
 * frame of its last `searchMs`.
 */
export function cutPoints(
  audio: PcmAudio,
  maxPieceMs = MAX_PIECE_MS,
  searchMs = CUT_SEARCH_MS,
): number[] {
  const { frameSamples, loudness } = frameLoudness(audio);
  const framesPerPiece = Math.max(1, Math.floor(maxPieceMs / FRAME_MS));
  const searchFrames = Math.min(framesPerPiece - 1, Math.floor(searchMs / FRAME_MS));
  const cuts: number[] = [];
  let pieceStart = 0;
  while (loudness.length - pieceStart > framesPerPiece) {
    const latest = pieceStart + framesPerPiece;
    let cut = latest;
    let quietest = Number.POSITIVE_INFINITY;
    for (let frame = latest; frame >= latest - searchFrames; frame -= 1) {
      const value = loudness[frame - 1] ?? Number.POSITIVE_INFINITY;
      if (value < quietest) {
        quietest = value;
        cut = frame;
      }
    }
    cuts.push(cut * frameSamples);
    pieceStart = cut;
  }
  return cuts;
}

/** How a whole recording is transcribed, beyond its type and language. */
export interface TranscribeRecordingOptions {
  mimeType: string;
  languageCode: string;
  maxPieceMs?: number;
  /**
   * Pieces sent at once (1 when left out); the transcript keeps the recording's order whatever
   * order the answers come in. A long vault recording (K3) sends a few at once to finish within
   * its route's time.
   */
  concurrency?: number;
  /** Once aborted, no further piece is sent and the transcription throws the signal's reason. */
  signal?: AbortSignal;
  /** Told each piece's length just before it is sent, so the caller can count what it pays for. */
  onPiece?: (pieceMs: number) => void;
}

/**
 * Transcribes a whole WAV recording piece by piece with a batch adapter, `concurrency` pieces at a
 * time, and joins the pieces' text with spaces in the recording's order. `ms` is the calls' time
 * together. A piece that fails stops the rest: none is sent after it, and the failure is thrown.
 */
export async function transcribeRecording(
  audio: Uint8Array,
  options: TranscribeRecordingOptions,
  stt: SpeechToText,
): Promise<Transcript> {
  if (!WAV_MIME_TYPES.includes(options.mimeType.toLowerCase())) {
    throw new Error('transcribeRecording reads 16-bit PCM WAV only');
  }
  const pcm = readWav(audio);
  const cuts = [...cutPoints(pcm, options.maxPieceMs ?? MAX_PIECE_MS), pcm.samples.length];
  const pieces: { start: number; end: number }[] = [];
  let start = 0;
  for (const end of cuts) {
    if (end <= start) continue;
    pieces.push({ start, end });
    start = end;
  }
  const answers: Transcript[] = [];
  let next = 0;
  let stopped = false;
  const sendPieces = async () => {
    while (!stopped && next < pieces.length) {
      const index = next;
      next += 1;
      const piece = pieces[index];
      if (piece === undefined) break;
      try {
        options.signal?.throwIfAborted();
        const samples = pcm.samples.subarray(piece.start, piece.end);
        options.onPiece?.(durationMs({ ...pcm, samples }));
        answers[index] = await stt.transcribe(writeWav({ ...pcm, samples }), {
          mimeType: 'audio/wav',
          languageCode: options.languageCode,
        });
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(options.concurrency ?? 1), pieces.length));
  await Promise.all(Array.from({ length: lanes }, sendPieces));
  const texts = answers.map((answer) => answer.text.trim()).filter((text) => text !== '');
  return {
    text: texts.join(' '),
    languageCode: answers.find((answer) => answer.languageCode !== undefined)?.languageCode,
    ms: answers.reduce((sum, answer) => sum + answer.ms, 0),
  };
}
