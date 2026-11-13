import {
  asArray,
  asObject,
  asString,
  at,
  defaultHttpDeps,
  ProviderError,
  providerFetch,
  type HttpDeps,
} from '../http';
import {
  systemClock,
  type Clock,
  type SpeechChunk,
  type SpeechToText,
  type StreamingSpeechToText,
  type StreamingTextToSpeech,
  type SttEvent,
  type TextToSpeech,
} from './ports';
import { romanOnly } from './roman-script';
import { keyFrom, parseVendorJson, vendorJsonBody } from './vendor-json';
import { webSocketOpener, type OpenSocket, type VendorSocket } from './socket';

/**
 * Sarvam AI, the lead speech vendor for Hindi, Hinglish and Indian English (BLUEPRINT §9.2,
 * docs/03-roadmap-appendix/phase2.md §5.3). Batch REST calls and the streaming WebSockets, behind
 * the ports of `ports.ts`.
 *
 * Speech to text asks Saaras for Roman script (`mode=translit`, which Saaras v3 and v4 take), and
 * every transcript passes `romanOnly()`. Text to speech sends the Roman-script line as written.
 *
 * The request and answer shapes follow Sarvam's published API reference as read on 13-11-2026
 * (docs/04-architecture-appendix/voice.md §6); the tests pin them on fixtures written from that
 * reference, marked as such, which a recorded answer replaces once the owner's key exists. The
 * streaming shapes in particular are confirmed against the live service in part 2.
 */

export interface SarvamConfig {
  apiKey: string;
  baseUrl: string;
  /** The streaming endpoints' base: `wss://` on the same host. */
  socketUrl: string;
  sttModel: string;
  /** Saaras's output mode; `translit` answers Roman script. */
  sttMode: string;
  ttsModel: string;
  speaker: string;
  /** The streaming speech's audio: raw 16-bit PCM, so a room can play it as it comes. */
  ttsCodec: string;
  ttsSampleRate: number;
}

export const SARVAM_TIMEOUT_MS = 15_000;
/** How long a stream waits for the vendor to settle after the last audio or text. */
export const SARVAM_SETTLE_MS = 5_000;

export function sarvamConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SarvamConfig | undefined {
  const apiKey = keyFrom(env.SARVAM_API_KEY, 'SARVAM_API_KEY');
  if (apiKey === undefined) return undefined;
  const pick = (name: string, fallback: string) => {
    const value = env[name]?.trim() ?? '';
    return value === '' ? fallback : value;
  };
  return {
    apiKey,
    baseUrl: 'https://api.sarvam.ai',
    socketUrl: 'wss://api.sarvam.ai',
    sttModel: pick('SARVAM_STT_MODEL', 'saaras:v3'),
    sttMode: pick('SARVAM_STT_MODE', 'translit'),
    ttsModel: pick('SARVAM_TTS_MODEL', 'bulbul:v2'),
    speaker: pick('SARVAM_TTS_SPEAKER', 'anushka'),
    ttsCodec: 'linear16',
    ttsSampleRate: 16_000,
  };
}

/** Saarika (the older model) takes no mode and answers Hindi in Devanagari, which is refused. */
const takesMode = (model: string) => model.startsWith('saaras:');

async function checked(response: Response): Promise<unknown> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const code = asString(at(body, 'error', 'code'));
    throw new ProviderError('sarvam', 'http', {
      status: response.status,
      ...(code === undefined ? {} : { vendorCode: code }),
    });
  }
  return vendorJsonBody('sarvam', response);
}

export function sarvamSpeech(
  config: SarvamConfig,
  deps: HttpDeps = defaultHttpDeps(SARVAM_TIMEOUT_MS),
  clock: Clock = systemClock,
): SpeechToText & TextToSpeech {
  const headers = { 'api-subscription-key': config.apiKey };
  return {
    vendor: 'sarvam',

    async transcribe(audio, options) {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(audio)], { type: options.mimeType }), 'turn.wav');
      form.set('model', config.sttModel);
      if (takesMode(config.sttModel)) form.set('mode', config.sttMode);
      form.set('language_code', options.languageCode);
      const started = clock.now();
      const response = await providerFetch('sarvam', deps, `${config.baseUrl}/speech-to-text`, {
        method: 'POST',
        headers,
        body: form,
      });
      const body = await checked(response);
      const ms = clock.now() - started;
      const text = asString(at(body, 'transcript'));
      if (text === undefined) {
        throw new ProviderError('sarvam', 'invalid_response', { status: response.status });
      }
      return {
        text: romanOnly('sarvam', text, response.status),
        languageCode: asString(at(body, 'language_code')),
        ms,
      };
    },

    async synthesize(text, options) {
      const started = clock.now();
      const response = await providerFetch('sarvam', deps, `${config.baseUrl}/text-to-speech`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          target_language_code: options.languageCode,
          speaker: options.speaker ?? config.speaker,
          model: config.ttsModel,
        }),
      });
      const body = await checked(response);
      const ms = clock.now() - started;
      const first = asString(asArray(at(body, 'audios'))[0]);
      if (first === undefined || first === '') {
        throw new ProviderError('sarvam', 'invalid_response', { status: response.status });
      }
      return { audio: Buffer.from(first, 'base64'), mimeType: 'audio/wav', ms };
    },
  };
}

export interface SarvamStreamDeps {
  openSocket?: OpenSocket;
  clock?: Clock;
  settleMs?: number;
}

function parseFrame(frame: string): { type: string | undefined; data: unknown } {
  const body = parseVendorJson('sarvam', frame);
  return { type: asString(at(body, 'type')), data: at(body, 'data') };
}

/** The iterator's next value, or a `timeout` once `ms` has passed. */
async function nextWithin<T>(iterator: AsyncIterator<T>, ms: number): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        reject(new ProviderError('sarvam', 'timeout'));
      },
      Math.max(0, ms),
    );
  });
  try {
    return await Promise.race([iterator.next(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function frameError(data: unknown): ProviderError {
  const code = asString(at(data, 'code'));
  return new ProviderError('sarvam', 'http', {
    status: 200,
    ...(code === undefined ? {} : { vendorCode: code }),
  });
}

/**
 * Streaming speech to text over `wss://api.sarvam.ai/speech-to-text/ws`: audio goes up as base64
 * PCM frames, voice-activity signals (`START_SPEECH`, `END_SPEECH`) and settled transcripts come
 * back. This endpoint sends no partial transcripts; Sarvam's realtime endpoint, which does, needs
 * access the vendor grants (voice.md §6).
 */
export function sarvamStreamingStt(
  config: SarvamConfig,
  deps: SarvamStreamDeps = {},
): StreamingSpeechToText {
  const open = deps.openSocket ?? webSocketOpener('sarvam', SARVAM_TIMEOUT_MS);
  const clock = deps.clock ?? systemClock;
  const settleMs = deps.settleMs ?? SARVAM_SETTLE_MS;
  return {
    vendor: 'sarvam',
    async open(options) {
      const query = new URLSearchParams({
        'language-code': options.languageCode,
        model: config.sttModel,
        ...(takesMode(config.sttModel) ? { mode: config.sttMode } : {}),
        sample_rate: String(options.sampleRate),
        vad_signals: 'true',
        high_vad_sensitivity: 'true',
      });
      const socket = await open(`${config.socketUrl}/speech-to-text/ws?${query.toString()}`, {
        'api-subscription-key': config.apiKey,
      });
      let ended = false;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        clearTimeout(settleTimer);
        socket.close();
      };

      async function* events(): AsyncGenerator<SttEvent> {
        try {
          for await (const frame of socket.messages) {
            const { type, data } = parseFrame(frame);
            const atMs = clock.now();
            if (type === 'error') throw frameError(data);
            if (type === 'events') {
              const signal = asString(at(data, 'signal_type'));
              if (signal === 'START_SPEECH') yield { type: 'speech_start', atMs };
              else if (signal === 'END_SPEECH') yield { type: 'speech_end', atMs };
            } else if (type === 'data') {
              const text = asString(at(data, 'transcript'));
              if (text === undefined) throw new ProviderError('sarvam', 'invalid_response');
              if (text.trim() !== '') {
                yield {
                  type: 'final',
                  text: romanOnly('sarvam', text),
                  languageCode: asString(at(data, 'language_code')),
                  atMs,
                };
              }
              // After the last audio, the settled transcript is the answer; nothing else is awaited.
              if (ended) return;
            }
          }
        } finally {
          stop();
        }
      }

      return {
        send(audio) {
          socket.send(
            JSON.stringify({
              audio: {
                data: Buffer.from(audio).toString('base64'),
                encoding: 'audio/wav',
                sample_rate: options.sampleRate,
              },
            }),
          );
        },
        end() {
          if (ended) return;
          ended = true;
          socket.send(JSON.stringify({ type: 'flush' }));
          settleTimer = setTimeout(stop, settleMs);
        },
        close: stop,
        events: events(),
      };
    },
  };
}

/**
 * Streaming text to speech over `wss://api.sarvam.ai/text-to-speech/ws`: a `config` frame when
 * opened, then for each sentence a `text` frame and a `flush`; the audio comes back in base64
 * chunks, and an `event` frame of type `final` closes the sentence.
 */
export function sarvamStreamingTts(
  config: SarvamConfig,
  deps: SarvamStreamDeps = {},
): StreamingTextToSpeech {
  const open = deps.openSocket ?? webSocketOpener('sarvam', SARVAM_TIMEOUT_MS);
  const clock = deps.clock ?? systemClock;
  const settleMs = deps.settleMs ?? SARVAM_SETTLE_MS;
  const mimeType = `audio/L16;rate=${String(config.ttsSampleRate)}`;
  return {
    vendor: 'sarvam',
    async open(options) {
      const query = new URLSearchParams({ model: config.ttsModel });
      const socket: VendorSocket = await open(
        `${config.socketUrl}/text-to-speech/ws?${query.toString()}`,
        { 'api-subscription-key': config.apiKey },
      );
      socket.send(
        JSON.stringify({
          type: 'config',
          data: {
            target_language_code: options.languageCode,
            speaker: options.speaker ?? config.speaker,
            output_audio_codec: config.ttsCodec,
            speech_sample_rate: config.ttsSampleRate,
          },
        }),
      );
      // One reader for the socket's life: each `speak()` reads its sentence's frames from it.
      const frames = socket.messages[Symbol.asyncIterator]();
      let speaking = false;

      async function* speak(text: string): AsyncGenerator<SpeechChunk> {
        if (speaking) throw new Error('one sentence at a time on a speech stream');
        speaking = true;
        const deadline = Date.now() + settleMs;
        try {
          socket.send(JSON.stringify({ type: 'text', data: { text } }));
          socket.send(JSON.stringify({ type: 'flush' }));
          for (;;) {
            const frame = await nextWithin(frames, deadline - Date.now());
            if (frame.done === true) throw new ProviderError('sarvam', 'invalid_response');
            const { type, data } = parseFrame(frame.value);
            if (type === 'error') throw frameError(data);
            if (type === 'audio') {
              const audio = asString(at(data, 'audio'));
              if (audio === undefined || audio === '') {
                throw new ProviderError('sarvam', 'invalid_response');
              }
              yield {
                audio: Buffer.from(audio, 'base64'),
                mimeType: asString(at(data, 'content_type')) ?? mimeType,
                atMs: clock.now(),
              };
            } else if (type === 'event' && asObject(data)?.event_type === 'final') {
              return;
            }
          }
        } catch (error) {
          // A sentence that failed leaves the stream in an unknown place: it is not used again.
          socket.close();
          throw error;
        } finally {
          speaking = false;
        }
      }

      return {
        speak,
        close: () => {
          socket.close();
        },
      };
    },
  };
}
