import { describe, expect, it } from 'vitest';
import type { SpeechChunk, SttEvent } from './ports';
import { replaySockets, ReplayClock, type RecordedSession } from './recorded';
import { sarvamConfig, sarvamStreamingStt, sarvamStreamingTts } from './sarvam';
import { AsyncQueue, type OpenSocket, type VendorSocket } from './socket';

// Fixtures written from Sarvam's published WebSocket reference (docs/04-architecture-appendix/
// voice.md §6), not recorded: a recorded session replaces each once the owner's key exists.
const NOTE = 'written from the Sarvam streaming reference as read on 13-11-2026';

const config = sarvamConfig({ SARVAM_API_KEY: 'sarvam-test-key' });
if (config === undefined) throw new Error('config expected');

const STT_SESSION: RecordedSession = {
  source: 'written',
  note: NOTE,
  frames: [
    { atMs: 180, data: { type: 'events', data: { signal_type: 'START_SPEECH' } } },
    { atMs: 2_610, data: { type: 'events', data: { signal_type: 'END_SPEECH' } } },
    {
      atMs: 2_830,
      data: {
        type: 'data',
        data: {
          request_id: 'r-1',
          transcript: 'paanch HP pump ka stock hai kya',
          language_code: 'hi-IN',
        },
      },
    },
  ],
};

const TTS_SESSION: RecordedSession = {
  source: 'written',
  note: NOTE,
  frames: [
    {
      atMs: 230,
      data: { type: 'audio', data: { content_type: 'audio/wav', audio: 'UklGRg==' } },
    },
    { atMs: 260, data: { type: 'audio', data: { audio: 'AAAA' } } },
    { atMs: 270, data: { type: 'event', data: { event_type: 'final' } } },
  ],
};

/** A socket the vendor never answers on; closing it ends its frames, as a live one does. */
function silentSocket(): { open: OpenSocket; closed: () => boolean } {
  const frames = new AsyncQueue<string>();
  let closed = false;
  const socket: VendorSocket = {
    send: () => undefined,
    close: () => {
      closed = true;
      frames.close();
    },
    messages: frames,
  };
  return { open: () => Promise.resolve(socket), closed: () => closed };
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

describe('Sarvam streaming speech to text', () => {
  it('opens the documented socket, sends base64 audio and a flush, and times the events', async () => {
    const clock = new ReplayClock();
    const replay = replaySockets([STT_SESSION], clock);
    const stt = sarvamStreamingStt(config, { openSocket: replay.open, clock });
    const stream = await stt.open({ languageCode: 'hi-IN', sampleRate: 16_000 });
    stream.send(new Uint8Array([1, 0, 2, 0]));
    stream.end();
    const events: SttEvent[] = await collect(stream.events);

    expect(events).toEqual([
      { type: 'speech_start', atMs: 180 },
      { type: 'speech_end', atMs: 2_610 },
      {
        type: 'final',
        text: 'paanch HP pump ka stock hai kya',
        languageCode: 'hi-IN',
        atMs: 2_830,
      },
    ]);
    const [opened] = replay.sent;
    const url = new URL(opened?.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe('wss://api.sarvam.ai/speech-to-text/ws');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'language-code': 'hi-IN',
      model: 'saaras:v3',
      mode: 'translit',
      sample_rate: '16000',
      vad_signals: 'true',
      high_vad_sensitivity: 'true',
    });
    expect(opened?.headers).toEqual({ 'api-subscription-key': 'sarvam-test-key' });
    expect(opened?.frames).toEqual([
      { audio: { data: 'AQACAA==', encoding: 'audio/wav', sample_rate: 16_000 } },
      { type: 'flush' },
    ]);
  });

  it('refuses a transcript in Devanagari and turns an error frame into a provider error', async () => {
    const clock = new ReplayClock();
    const devanagari: RecordedSession = {
      source: 'written',
      note: NOTE,
      frames: [
        // The word for "pump" in Devanagari, as escapes (ADR 0014).
        { atMs: 10, data: { type: 'data', data: { transcript: 'पंप' } } },
      ],
    };
    const failed: RecordedSession = {
      source: 'written',
      note: NOTE,
      frames: [{ atMs: 10, data: { type: 'error', data: { message: 'x', code: 'rate_limited' } } }],
    };
    const replay = replaySockets([devanagari, failed], clock);
    const stt = sarvamStreamingStt(config, { openSocket: replay.open, clock });

    const first = await stt.open({ languageCode: 'hi-IN', sampleRate: 16_000 });
    first.send(new Uint8Array(2));
    await expect(collect(first.events)).rejects.toMatchObject({ vendorCode: 'not_roman_script' });

    const second = await stt.open({ languageCode: 'hi-IN', sampleRate: 16_000 });
    second.send(new Uint8Array(2));
    await expect(collect(second.events)).rejects.toMatchObject({
      provider: 'sarvam',
      vendorCode: 'rate_limited',
    });
  });

  it('stops waiting once the settle time after the last audio has passed', async () => {
    const silent = silentSocket();
    const stt = sarvamStreamingStt(config, { openSocket: silent.open, settleMs: 10 });
    const stream = await stt.open({ languageCode: 'hi-IN', sampleRate: 8_000 });
    stream.send(new Uint8Array(2));
    stream.end();
    expect(await collect(stream.events)).toEqual([]);
    expect(silent.closed()).toBe(true);
  });
});

describe('Sarvam streaming text to speech', () => {
  it('configures once, speaks a sentence and times its first audio', async () => {
    const clock = new ReplayClock();
    clock.advanceTo(1_000);
    const replay = replaySockets([TTS_SESSION], clock);
    const tts = sarvamStreamingTts(config, { openSocket: replay.open, clock });
    const stream = await tts.open({ languageCode: 'hi-IN' });
    const chunks: SpeechChunk[] = await collect(stream.speak('Ji, stock mein hai.'));
    stream.close();

    expect(chunks.map((c) => c.atMs)).toEqual([1_230, 1_260]);
    expect(chunks[0]?.mimeType).toBe('audio/wav');
    expect(chunks[1]?.mimeType).toBe('audio/L16;rate=16000');
    expect(Buffer.from(chunks[0]?.audio ?? []).toString()).toBe('RIFF');
    const [opened] = replay.sent;
    expect(opened?.url).toBe('wss://api.sarvam.ai/text-to-speech/ws?model=bulbul%3Av2');
    expect(opened?.frames).toEqual([
      {
        type: 'config',
        data: {
          target_language_code: 'hi-IN',
          speaker: 'anushka',
          output_audio_codec: 'linear16',
          speech_sample_rate: 16_000,
        },
      },
      { type: 'text', data: { text: 'Ji, stock mein hai.' } },
      { type: 'flush' },
    ]);
  });

  it('fails a sentence whose stream ends before its final event', async () => {
    const clock = new ReplayClock();
    const cut: RecordedSession = {
      source: 'written',
      note: NOTE,
      frames: [{ atMs: 5, data: { type: 'audio', data: { audio: 'AAAA' } } }],
    };
    const tts = sarvamStreamingTts(config, {
      openSocket: replaySockets([cut], clock).open,
      clock,
    });
    const stream = await tts.open({ languageCode: 'hi-IN' });
    await expect(collect(stream.speak('Ji.'))).rejects.toMatchObject({
      failure: 'invalid_response',
    });
  });

  it('times out a sentence the vendor never finishes, and closes the stream', async () => {
    const silent = silentSocket();
    const tts = sarvamStreamingTts(config, { openSocket: silent.open, settleMs: 20 });
    const stream = await tts.open({ languageCode: 'hi-IN' });
    await expect(collect(stream.speak('Ji.'))).rejects.toMatchObject({ failure: 'timeout' });
    expect(silent.closed()).toBe(true);
  });
});
