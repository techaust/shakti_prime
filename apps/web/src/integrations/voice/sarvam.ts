import {
  asArray,
  asString,
  at,
  defaultHttpDeps,
  jsonBody,
  ProviderError,
  providerFetch,
  type HttpDeps,
} from '../http';
import type { SpeechToText, TextToSpeech } from './ports';

/**
 * Sarvam AI, the lead speech vendor candidate for Hindi, Hinglish and Indian English (BLUEPRINT
 * §9.2, ROADMAP week 6). Batch REST calls only; the worker will use the streaming endpoints. The
 * request and answer shapes follow Sarvam's REST reference and are pinned by the fixture tests;
 * the first spike run confirms them against the live service.
 */

export interface SarvamConfig {
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  speaker: string;
}

export const SARVAM_TIMEOUT_MS = 15_000;

export function sarvamConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SarvamConfig | undefined {
  const apiKey = env.SARVAM_API_KEY ?? '';
  if (apiKey === '') return undefined;
  const pick = (name: string, fallback: string) => {
    const value = env[name] ?? '';
    return value === '' ? fallback : value;
  };
  return {
    apiKey,
    baseUrl: 'https://api.sarvam.ai',
    sttModel: pick('SARVAM_STT_MODEL', 'saarika:v2.5'),
    ttsModel: pick('SARVAM_TTS_MODEL', 'bulbul:v2'),
    speaker: pick('SARVAM_TTS_SPEAKER', 'anushka'),
  };
}

async function checked(response: Response): Promise<unknown> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const code = asString(at(body, 'error', 'code'));
    throw new ProviderError('sarvam', 'http', {
      status: response.status,
      ...(code === undefined ? {} : { vendorCode: code }),
    });
  }
  return jsonBody('sarvam', response);
}

export function sarvamSpeech(
  config: SarvamConfig,
  deps: HttpDeps = defaultHttpDeps(SARVAM_TIMEOUT_MS),
): SpeechToText & TextToSpeech {
  const headers = { 'api-subscription-key': config.apiKey };
  return {
    vendor: 'sarvam',

    async transcribe(audio, options) {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(audio)], { type: options.mimeType }), 'turn.wav');
      form.set('model', config.sttModel);
      form.set('language_code', options.languageCode);
      const started = performance.now();
      const response = await providerFetch('sarvam', deps, `${config.baseUrl}/speech-to-text`, {
        method: 'POST',
        headers,
        body: form,
      });
      const body = await checked(response);
      const ms = performance.now() - started;
      const text = asString(at(body, 'transcript'));
      if (text === undefined) {
        throw new ProviderError('sarvam', 'invalid_response', { status: response.status });
      }
      return { text, languageCode: asString(at(body, 'language_code')), ms };
    },

    async synthesize(text, options) {
      const started = performance.now();
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
      const ms = performance.now() - started;
      const first = asString(asArray(at(body, 'audios'))[0]);
      if (first === undefined || first === '') {
        throw new ProviderError('sarvam', 'invalid_response', { status: response.status });
      }
      return { audio: Buffer.from(first, 'base64'), mimeType: 'audio/wav', ms };
    },
  };
}
