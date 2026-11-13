import { AGENT_DEFAULTS } from '@shakti/domain';
import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { bodyOf, stubFetch, urlOf } from '../test-fetch';
import {
  claudeConfig,
  claudeReplyModel,
  DEFAULT_VOICE_SPIKE_MODEL,
  readSse,
} from './claude-stream';
import { percentile, runTurn, summarize } from './latency';
import { liveKitHttpBase, liveKitRooms, liveKitToken } from './livekit';
import type { ReplyModel, SpeechToText, TextToSpeech } from './ports';
import { PRONUNCIATION_CHECKLIST } from './pronunciation-checklist';
import { hasDevanagari } from './roman-script';
import { sarvamConfig, sarvamSpeech } from './sarvam';

// Low-entropy phrases, so the secret scan never mistakes them for keys (CLAUDE.md).
const LIVEKIT = {
  url: 'wss://shakti-spike.livekit.test',
  apiKey: 'livekit-test-key',
  apiSecret: 'livekit-test-secret-livekit-test-secret',
};

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** A Messages API stream as the API sends it, split mid-event to test the buffering. */
const CLAUDE_STREAM = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","role":"assistant","usage":{"input_tokens":42,"output_tokens":1}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ji, 5 HP pump "}}\n\nevent: content_block_del',
  'ta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"stock mein hai. Kal"}}\n\n',
  'event: ping\ndata: {"type":"ping"}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" dispatch ho jayega."}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":18}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

describe('latency statistics', () => {
  it('uses nearest-rank percentiles', () => {
    const values = [900, 1200, 1100, 1000, 3000, 1300, 1250, 1150, 1050, 950];
    expect(percentile(values, 50)).toBe(1100);
    expect(percentile(values, 95)).toBe(3000);
    expect(summarize(values)).toEqual({ n: 10, p50: 1100, p95: 3000, min: 900, max: 3000 });
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});

describe('the Claude stream', () => {
  it('splits server-sent events across chunk boundaries', async () => {
    const events = [];
    for await (const e of readSse(stream(CLAUDE_STREAM))) events.push(e.event);
    expect(events).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'ping',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
  });

  it('times the first text and the first sentence, and sends the documented request', async () => {
    const fetchImpl = stubFetch(() => new Response(stream(CLAUDE_STREAM), { status: 200 }));
    const config = claudeConfig({ ANTHROPIC_API_KEY: 'anthropic-test-key' });
    if (config === undefined) throw new Error('config expected');
    const model = claudeReplyModel(config, { fetch: fetchImpl, timeoutMs: 1_000 });
    const reply = await model.reply('Speak briefly.', 'pump ka stock hai?');
    expect(reply.text).toBe('Ji, 5 HP pump stock mein hai. Kal dispatch ho jayega.');
    expect(reply.firstSentence).toBe('Ji, 5 HP pump stock mein hai.');
    expect(reply.firstTokenMs).toBeLessThanOrEqual(reply.firstSentenceMs);
    expect(reply.firstSentenceMs).toBeLessThanOrEqual(reply.totalMs);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-api-key')).toBe('anthropic-test-key');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(JSON.parse(bodyOf(init))).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 400,
      stream: true,
      system: 'Speak briefly.',
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'pump ka stock hai?' }],
    });
    expect(reply.usage).toEqual({
      inputTokens: 42,
      outputTokens: 18,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('takes the voice model from AGENT_DEFAULTS, and only a priced model to compare', () => {
    const key = { ANTHROPIC_API_KEY: 'anthropic-test-key' };
    expect(DEFAULT_VOICE_SPIKE_MODEL).toBe(AGENT_DEFAULTS.voice.model);
    expect(claudeConfig(key)?.model).toBe('claude-sonnet-5-5');
    expect(claudeConfig({ ...key, VOICE_SPIKE_MODEL: '  ' })?.model).toBe('claude-sonnet-5-5');
    const haiku = claudeConfig({ ...key, VOICE_SPIKE_MODEL: 'claude-haiku-5-5' });
    expect(haiku).toMatchObject({ model: 'claude-haiku-5-5', thinking: undefined });
    expect(() => claudeConfig({ ...key, VOICE_SPIKE_MODEL: 'claude-sonnet-5' })).toThrow(
      /does not list/,
    );
    expect(claudeConfig({})).toBeUndefined();
  });

  it('refuses a declined reply', async () => {
    const config = claudeConfig({ ANTHROPIC_API_KEY: 'anthropic-test-key' });
    if (config === undefined) throw new Error('config expected');
    const declined = claudeReplyModel(config, {
      fetch: () =>
        Promise.resolve(
          new Response(
            stream([
              'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ji. "}}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n',
            ]),
          ),
        ),
      timeoutMs: 1_000,
    });
    await expect(declined.reply('s', 'u')).rejects.toMatchObject({ vendorCode: 'refusal' });
  });

  it('turns an error event or an error status into a provider error', async () => {
    const config = claudeConfig({ ANTHROPIC_API_KEY: 'anthropic-test-key' });
    if (config === undefined) throw new Error('config expected');
    const overloaded = claudeReplyModel(config, {
      fetch: () =>
        Promise.resolve(
          new Response(
            stream([
              'event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n',
            ]),
          ),
        ),
      timeoutMs: 1_000,
    });
    await expect(overloaded.reply('s', 'u')).rejects.toMatchObject({
      vendorCode: 'overloaded_error',
    });
    const refused = claudeReplyModel(config, {
      fetch: () =>
        Promise.resolve(
          Response.json({ error: { type: 'authentication_error' } }, { status: 401 }),
        ),
      timeoutMs: 1_000,
    });
    await expect(refused.reply('s', 'u')).rejects.toMatchObject({ status: 401 });
  });
});

describe('Sarvam', () => {
  const config = sarvamConfig({ SARVAM_API_KEY: 'sarvam-test-key' });
  if (config === undefined) throw new Error('config expected');

  it('sends the recording as a form, asks for Roman script and reads the transcript', async () => {
    const fetchImpl = stubFetch(() =>
      Response.json({
        request_id: 'r1',
        transcript: 'pump ka stock hai',
        language_code: 'hi-IN',
      }),
    );
    const speech = sarvamSpeech(config, { fetch: fetchImpl, timeoutMs: 1_000 });
    const result = await speech.transcribe(new Uint8Array([1, 2, 3]), {
      mimeType: 'audio/wav',
      languageCode: 'hi-IN',
    });
    expect(result).toMatchObject({ text: 'pump ka stock hai', languageCode: 'hi-IN' });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe('https://api.sarvam.ai/speech-to-text');
    expect(new Headers(init?.headers).get('api-subscription-key')).toBe('sarvam-test-key');
    const form = init?.body as FormData;
    expect(form.get('model')).toBe('saaras:v3');
    expect(form.get('mode')).toBe('translit');
    expect(form.get('language_code')).toBe('hi-IN');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('refuses a transcript in Devanagari, naming no text', async () => {
    // "pump ka stock hai" with its first word in Devanagari, built from code points (ADR 0014).
    const pump = String.fromCodePoint(0x092a, 0x0902, 0x092a);
    const fetchImpl = stubFetch(() =>
      Response.json({ transcript: `${pump} ka stock hai`, language_code: 'hi-IN' }),
    );
    const speech = sarvamSpeech(config, { fetch: fetchImpl, timeoutMs: 1_000 });
    const failed = speech.transcribe(new Uint8Array([1]), {
      mimeType: 'audio/wav',
      languageCode: 'hi-IN',
    });
    await expect(failed).rejects.toMatchObject({
      failure: 'invalid_response',
      vendorCode: 'not_roman_script',
    });
    await expect(failed).rejects.not.toThrow(/stock/);
  });

  it('asks for speech and decodes the audio', async () => {
    const fetchImpl = stubFetch(() =>
      Response.json({ request_id: 'r2', audios: [Buffer.from('RIFF').toString('base64')] }),
    );
    const speech = sarvamSpeech(config, { fetch: fetchImpl, timeoutMs: 1_000 });
    const result = await speech.synthesize('Namaste', { languageCode: 'hi-IN' });
    expect(Buffer.from(result.audio).toString()).toBe('RIFF');
    expect(JSON.parse(bodyOf(fetchImpl.mock.calls[0]?.[1]))).toEqual({
      text: 'Namaste',
      target_language_code: 'hi-IN',
      speaker: 'anushka',
      model: 'bulbul:v2',
    });
  });

  it('reports a refusal and an answer without audio', async () => {
    const refused = sarvamSpeech(config, {
      fetch: () =>
        Promise.resolve(
          Response.json({ error: { code: 'invalid_api_key_error' } }, { status: 403 }),
        ),
      timeoutMs: 1_000,
    });
    await expect(refused.synthesize('x', { languageCode: 'hi-IN' })).rejects.toMatchObject({
      status: 403,
      vendorCode: 'invalid_api_key_error',
    });
    const empty = sarvamSpeech(config, {
      fetch: () => Promise.resolve(Response.json({ audios: [] })),
      timeoutMs: 1_000,
    });
    await expect(empty.synthesize('x', { languageCode: 'hi-IN' })).rejects.toMatchObject({
      failure: 'invalid_response',
    });
  });
});

describe('LiveKit', () => {
  it('signs access tokens LiveKit can verify with the API secret', async () => {
    const token = await liveKitToken(LIVEKIT, 'user-1', { roomJoin: true, room: 'r' });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(LIVEKIT.apiSecret), {
      issuer: 'livekit-test-key',
      subject: 'user-1',
    });
    expect(payload.video).toEqual({ roomJoin: true, room: 'r' });
  });

  it('calls the room service over HTTPS with a room-create grant', async () => {
    const fetchImpl = stubFetch(() => Response.json({ name: 'spike' }));
    await liveKitRooms(LIVEKIT, { fetch: fetchImpl, timeoutMs: 1_000 }).createRoom('spike');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe(
      'https://shakti-spike.livekit.test/twirp/livekit.RoomService/CreateRoom',
    );
    const bearer = new Headers(init?.headers).get('authorization')?.slice('Bearer '.length) ?? '';
    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(LIVEKIT.apiSecret));
    expect(payload.video).toEqual({ roomCreate: true });
    expect(liveKitHttpBase('wss://a.livekit.cloud/')).toBe('https://a.livekit.cloud');
  });
});

describe('one spoken turn', () => {
  it('adds the transcript, first sentence and its audio into the first-audio time', async () => {
    const stt: SpeechToText = {
      vendor: 'fake',
      transcribe: () => Promise.resolve({ text: 'stock?', languageCode: 'hi-IN', ms: 300 }),
    };
    const llm: ReplyModel = {
      vendor: 'fake',
      model: 'claude-sonnet-5-5',
      reply: () =>
        Promise.resolve({
          text: 'Ji haan. Kal aayega.',
          firstTokenMs: 250,
          firstSentenceMs: 400,
          firstSentence: 'Ji haan.',
          totalMs: 700,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        }),
    };
    const spoken: string[] = [];
    const tts: TextToSpeech = {
      vendor: 'fake',
      synthesize: (text) => {
        spoken.push(text);
        return Promise.resolve({ audio: new Uint8Array(), mimeType: 'audio/wav', ms: 200 });
      },
    };
    const turn = await runTurn(
      new Uint8Array(),
      { mimeType: 'audio/wav', languageCode: 'hi-IN', system: 's' },
      { stt, llm, tts },
    );
    expect(spoken).toEqual(['Ji haan.', 'Kal aayega.']);
    expect(turn.timing).toMatchObject({ firstAudioMs: 900, sequentialMs: 1400 });
  });
});

describe('the pronunciation checklist', () => {
  it('is Roman script only, with unique ids and something to listen for', () => {
    const ids = PRONUNCIATION_CHECKLIST.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const line of PRONUNCIATION_CHECKLIST) {
      expect(hasDevanagari(line.text)).toBe(false);
      expect(line.listenFor.length).toBeGreaterThan(10);
    }
  });
});

describe('a reply outside Roman script', () => {
  it('is refused, whether the event carries the script or its escape', async () => {
    const config = claudeConfig({ ANTHROPIC_API_KEY: 'anthropic-test-key' });
    if (config === undefined) throw new Error('config expected');
    const pump = String.fromCodePoint(0x092a, 0x0902, 0x092a);
    for (const piece of [pump, '\\u092a']) {
      const model = claudeReplyModel(config, {
        fetch: () =>
          Promise.resolve(
            new Response(
              stream([
                `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ji, ${piece} stock mein hai."}}\n\n`,
              ]),
            ),
          ),
        timeoutMs: 1_000,
      });
      await expect(model.reply('s', 'u')).rejects.toMatchObject({
        provider: 'anthropic',
        vendorCode: 'not_roman_script',
      });
    }
  });
});

describe('vendor text in errors', () => {
  it('turns a malformed Sarvam frame or Claude event into an error with no cause or text', async () => {
    const config = claudeConfig({ ANTHROPIC_API_KEY: 'anthropic-test-key' });
    if (config === undefined) throw new Error('config expected');
    const model = claudeReplyModel(config, {
      fetch: () =>
        Promise.resolve(
          new Response(stream(['event: content_block_delta\ndata: {"delta": paanch HP\n\n'])),
        ),
      timeoutMs: 1_000,
    });
    const failed = model.reply('s', 'u');
    await expect(failed).rejects.toMatchObject({ failure: 'invalid_response', cause: undefined });
    await expect(failed).rejects.not.toThrow(/paanch/);

    const sarvam = sarvamConfig({ SARVAM_API_KEY: 'sarvam-test-key' });
    if (sarvam === undefined) throw new Error('config expected');
    const batch = sarvamSpeech(sarvam, {
      fetch: () => Promise.resolve(new Response('{"transcript": paanch HP', { status: 200 })),
      timeoutMs: 1_000,
    }).transcribe(new Uint8Array(1), { mimeType: 'audio/wav', languageCode: 'hi-IN' });
    await expect(batch).rejects.toMatchObject({ failure: 'invalid_response', cause: undefined });
    await expect(batch).rejects.not.toThrow(/paanch/);
  });

  it('trims the keys and refuses one holding a control character, without quoting it', () => {
    expect(sarvamConfig({ SARVAM_API_KEY: '  sarvam-test-key\n' })?.apiKey).toBe('sarvam-test-key');
    expect(sarvamConfig({ SARVAM_API_KEY: '   ' })).toBeUndefined();
    expect(() => sarvamConfig({ SARVAM_API_KEY: 'sarvam\u0007key' })).toThrow(
      'SARVAM_API_KEY holds a control character',
    );
    expect(() => claudeConfig({ ANTHROPIC_API_KEY: 'anthropic\u0000key' })).toThrow(
      /^ANTHROPIC_API_KEY holds a control character$/,
    );
  });
});
