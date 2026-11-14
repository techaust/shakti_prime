import { MAX_AUDIO_MS } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { readWav, writeWav } from '../../integrations/voice/recording';
import { checkRecording } from './audio-check';

const RATE = 8_000;

function wav(seconds: number): Uint8Array {
  const samples = new Int16Array(RATE * seconds);
  for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 === 0 ? 900 : -900;
  return writeWav({ sampleRate: RATE, channels: 1, samples });
}

describe('checkRecording', () => {
  it('keeps a WAV written afresh from its samples, without its other chunks', () => {
    const plain = wav(1);
    // A LIST chunk naming who recorded it, between the format and the data.
    const name = new TextEncoder().encode('LIST\u0008\u0000\u0000\u0000INFOIART');
    const tagged = new Uint8Array(plain.length + name.length);
    tagged.set(plain.subarray(0, 36));
    tagged.set(name, 36);
    tagged.set(plain.subarray(36), 36 + name.length);
    const checked = checkRecording(tagged);
    expect(checked).toMatchObject({ ok: true, sanitising: 'audio_checked' });
    if (!checked.ok) throw new Error('refused');
    expect(Buffer.from(checked.bytes).includes(Buffer.from('INFOIART'))).toBe(false);
    expect([...readWav(checked.bytes).samples]).toEqual([...readWav(plain).samples]);
  });

  it('refuses a recording longer than 30 minutes', () => {
    expect(MAX_AUDIO_MS).toBe(30 * 60 * 1000);
    expect(checkRecording(wav(30 * 60))).toMatchObject({ ok: true });
    expect(checkRecording(wav(30 * 60 + 1))).toEqual({ ok: false, reason: 'file_audio_too_long' });
  });

  it('refuses anything that is not a 16-bit PCM WAV, an MP3 renamed among them', () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]);
    expect(checkRecording(mp3)).toEqual({ ok: false, reason: 'file_unreadable' });
    const float = wav(1);
    // Format 3 (IEEE float) where 1 (PCM) stands.
    float[20] = 3;
    expect(checkRecording(float)).toEqual({ ok: false, reason: 'file_unreadable' });
  });
});
