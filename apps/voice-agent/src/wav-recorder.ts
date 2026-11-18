import { MAX_AUDIO_UPLOAD_BYTES } from '@shakti/contracts';
import { writeWav } from '@shakti/voice';
import { AUDIO_IN_SAMPLE_RATE } from './room';

/** The recording is kept at 8 kHz: speech stays clear, and 15 minutes fit a vault upload. */
export const RECORDING_SAMPLE_RATE = 8_000;
const KEEP_EVERY = AUDIO_IN_SAMPLE_RATE / RECORDING_SAMPLE_RATE;
/** Samples a recording may hold: a WAV's 44-byte header and 16-bit samples within the limit. */
const MAX_SAMPLES = Math.floor((MAX_AUDIO_UPLOAD_BYTES - 44) / 2);

/**
 * The person's speech of a Teach session they let be recorded (docs/03-roadmap-appendix/phase2.md
 * §7.5): every other sample of the 16 kHz input, kept until the vault upload's size, then written
 * as the 16-bit WAV the Knowledge Vault takes (K3). It is held in memory only and leaves the
 * worker once, to the file store, as the person.
 */
export class WavRecorder {
  private readonly chunks: Int16Array[] = [];
  private length = 0;
  private phase = 0;

  add(frame: Int16Array): void {
    if (this.length >= MAX_SAMPLES) return;
    const kept = new Int16Array(Math.ceil((frame.length - this.phase) / KEEP_EVERY));
    let n = 0;
    for (let i = this.phase; i < frame.length && this.length + n < MAX_SAMPLES; i += KEEP_EVERY) {
      kept[n] = frame[i] ?? 0;
      n += 1;
    }
    this.phase = (this.phase + KEEP_EVERY - (frame.length % KEEP_EVERY)) % KEEP_EVERY;
    this.chunks.push(kept.subarray(0, n));
    this.length += n;
  }

  get empty(): boolean {
    return this.length === 0;
  }

  /** The recording as a WAV. */
  wav(): Uint8Array {
    const samples = new Int16Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, at);
      at += chunk.length;
    }
    return writeWav({ sampleRate: RECORDING_SAMPLE_RATE, channels: 1, samples });
  }
}
