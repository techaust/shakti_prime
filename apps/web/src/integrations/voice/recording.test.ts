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

describe('a WAV header out of range', () => {
  /** A one-frame mono WAV with one little-endian header field of 2 or 4 bytes rewritten. */
  function patched(offset: number, width: 2 | 4, value: number): Uint8Array {
    const bytes = writeWav(pcm([true]));
    const view = new DataView(bytes.buffer);
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    return bytes;
  }

  it('refuses no channels before anything loops over the samples', () => {
    expect(() => readWav(patched(22, 2, 0))).toThrow('one or two channels');
    // The cutter refuses the same shape however it is reached, so it cannot spin on empty frames.
    const silent: PcmAudio = { sampleRate: RATE, channels: 0, samples: new Int16Array(160) };
    expect(() => cutPoints(silent)).toThrow('one or two channels');
    expect(() => speechEndMs(silent)).toThrow('one or two channels');
  });

  it('refuses three channels', () => {
    expect(() => readWav(patched(22, 2, 3))).toThrow('one or two channels');
  });

  it('refuses a sample rate outside 8 to 48 kHz', () => {
    expect(() => readWav(patched(24, 4, 7_999))).toThrow('8 to 48 kHz');
    expect(() => readWav(patched(24, 4, 48_001))).toThrow('8 to 48 kHz');
    expect(() => readWav(patched(24, 4, 12))).toThrow('8 to 48 kHz');
  });

  it('refuses a format chunk under 16 bytes', () => {
    expect(() => readWav(patched(16, 4, 14))).toThrow('format chunk too short');
  });

  it('refuses a block size other than two bytes a channel', () => {
    expect(() => readWav(patched(32, 2, 4))).toThrow('block size');
  });

  it('refuses an empty data chunk', () => {
    const empty = writeWav({ sampleRate: RATE, channels: 1, samples: new Int16Array(0) });
    expect(() => readWav(empty)).toThrow('WAV without audio');
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

  it('sends pieces a few at a time and keeps the recording’s order, counting each as it goes', async () => {
    const recording = writeWav(pcm(Array.from({ length: 250 }, () => true)));
    let open = 0;
    let most = 0;
    let calls = 0;
    const counted: number[] = [];
    const stt: SpeechToText = {
      vendor: 'fake',
      transcribe: async () => {
        calls += 1;
        const piece = calls;
        open += 1;
        most = Math.max(most, open);
        // Earlier pieces answer later, so the order is the recording's, not the answers'.
        await new Promise((resolve) => setTimeout(resolve, (6 - piece) * 3));
        open -= 1;
        return { text: `p${String(piece)}`, languageCode: undefined, ms: 10 };
      },
    };
    const transcript = await transcribeRecording(
      recording,
      {
        mimeType: 'audio/wav',
        languageCode: 'hi-IN',
        maxPieceMs: 1_000,
        concurrency: 3,
        onPiece: (ms) => counted.push(ms),
      },
      stt,
    );
    expect(transcript.text).toBe('p1 p2 p3 p4 p5');
    expect(transcript.ms).toBe(50);
    expect(most).toBe(3);
    expect(counted).toEqual([1_000, 1_000, 1_000, 1_000, 1_000]);
  });

  it('stops sending once a piece fails or the signal is aborted', async () => {
    const recording = writeWav(pcm(Array.from({ length: 250 }, () => true)));
    let sent = 0;
    const failing: SpeechToText = {
      vendor: 'fake',
      transcribe: () => {
        sent += 1;
        return sent === 2
          ? Promise.reject(new Error('vendor down'))
          : Promise.resolve({ text: 'ok', languageCode: undefined, ms: 1 });
      },
    };
    await expect(
      transcribeRecording(
        recording,
        { mimeType: 'audio/wav', languageCode: 'hi-IN', maxPieceMs: 1_000 },
        failing,
      ),
    ).rejects.toThrow('vendor down');
    expect(sent).toBe(2);

    const stop = new AbortController();
    let heard = 0;
    const stopping: SpeechToText = {
      vendor: 'fake',
      transcribe: () => {
        heard += 1;
        stop.abort(new Error('out of time'));
        return Promise.resolve({ text: 'ok', languageCode: undefined, ms: 1 });
      },
    };
    await expect(
      transcribeRecording(
        recording,
        { mimeType: 'audio/wav', languageCode: 'hi-IN', maxPieceMs: 1_000, signal: stop.signal },
        stopping,
      ),
    ).rejects.toThrow('out of time');
    expect(heard).toBe(1);
  });
});
