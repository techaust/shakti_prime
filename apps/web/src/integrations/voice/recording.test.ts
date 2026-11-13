import { describe, expect, it } from 'vitest';
import type { SpeechToText } from './ports';
import {
  cutPoints,
  durationMs,
  readWav,
  speechEndMs,
  transcribeRecording,
  writeWav,
  type PcmAudio,
} from './recording';

const RATE = 8_000;

/** A synthetic recording: loud tone where `loud` says so, near-silence elsewhere, in 20 ms frames. */
function pcm(frames: boolean[]): PcmAudio {
  const perFrame = (RATE * 20) / 1000;
  const samples = new Int16Array(frames.length * perFrame);
  frames.forEach((loud, frame) => {
    for (let i = 0; i < perFrame; i += 1) {
      samples[frame * perFrame + i] = loud ? (i % 2 === 0 ? 8_000 : -8_000) : i % 2 === 0 ? 3 : -3;
    }
  });
  return { sampleRate: RATE, channels: 1, samples };
}

describe('WAV reading and writing', () => {
  it('writes a WAV that reads back the same', () => {
    const audio = pcm([true, false, true]);
    const back = readWav(writeWav(audio));
    expect(back.sampleRate).toBe(RATE);
    expect(back.channels).toBe(1);
    expect([...back.samples]).toEqual([...audio.samples]);
    expect(durationMs(back)).toBe(60);
  });

  it('skips chunks before the data and refuses what is not 16-bit PCM', () => {
    const plain = writeWav(pcm([true]));
    // A LIST chunk of 3 bytes (padded to 4) between the format and the data.
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0]);
    const withList = new Uint8Array([...plain.subarray(0, 36), ...list, ...plain.subarray(36)]);
    expect(readWav(withList).samples.length).toBe(160);
    expect(() => readWav(new Uint8Array(8))).toThrow('not a WAV file');
    const float = new Uint8Array(plain);
    float[20] = 3;
    expect(() => readWav(float)).toThrow('only 16-bit PCM WAV is read');
  });
});

describe('where the speaker stops', () => {
  it('is the end of the last loud frame, or undefined for silence', () => {
    expect(speechEndMs(pcm([false, true, true, false, true, false, false]))).toBe(100);
    expect(speechEndMs(pcm([false, false]))).toBeUndefined();
  });
});

describe('cutting a long recording', () => {
  it('cuts each piece at the quietest frame near its end, under the limit', () => {
    // 3 s: speech, a quiet frame at 0.9 s, speech to the end.
    const frames = Array.from({ length: 150 }, (_, i) => i !== 45);
    const audio = pcm(frames);
    const cuts = cutPoints(audio, 1_000, 300);
    const perFrame = (RATE * 20) / 1000;
    // The first piece ends after the quiet frame (frame 45, so the cut is at frame 46).
    expect(cuts[0]).toBe(46 * perFrame);
    for (const [i, cut] of cuts.entries()) {
      const start = i === 0 ? 0 : (cuts[i - 1] ?? 0);
      expect(cut - start).toBeLessThanOrEqual(50 * perFrame);
    }
    expect(audio.samples.length - (cuts.at(-1) ?? 0)).toBeLessThanOrEqual(50 * perFrame);
    expect(cutPoints(pcm([true, true]), 1_000)).toEqual([]);
  });

  it('transcribes piece by piece and joins the text', async () => {
    const seen: number[] = [];
    const stt: SpeechToText = {
      vendor: 'fake',
      transcribe: (audio) => {
        seen.push(readWav(audio).samples.length);
        return Promise.resolve({
          text: ` piece ${String(seen.length)} `,
          languageCode: 'hi-IN',
          ms: 100,
        });
      },
    };
    const recording = writeWav(pcm(Array.from({ length: 150 }, () => true)));
    const transcript = await transcribeRecording(
      recording,
      { mimeType: 'audio/wav', languageCode: 'hi-IN', maxPieceMs: 1_000 },
      stt,
    );
    expect(transcript).toEqual({
      text: 'piece 1 piece 2 piece 3',
      languageCode: 'hi-IN',
      ms: 300,
    });
    expect(seen.reduce((a, b) => a + b, 0)).toBe(150 * 160);
    await expect(
      transcribeRecording(recording, { mimeType: 'audio/mpeg', languageCode: 'hi-IN' }, stt),
    ).rejects.toThrow('WAV only');
  });
});
