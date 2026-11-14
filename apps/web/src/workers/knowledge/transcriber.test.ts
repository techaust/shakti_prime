import { DomainError } from '@shakti/contracts';
import {
  createAiProvider,
  KnowledgeExtractError,
  memoryKeyValue,
  memoryLogger,
} from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { stubFetch } from '../../integrations/test-fetch';
import { SARVAM_PRICE } from '../../integrations/voice/benchmark/stand-in-set';
import { writeWav } from '../../integrations/voice/recording';
import { sarvamConfig, sarvamSpeech } from '../../integrations/voice/sarvam';
import { recordingTranscriber, vaultTranscriber } from './transcriber';

// The vault's speech service (K3) over V1's `transcribeRecording()` and the Sarvam adapter, on
// answers written in Sarvam's documented shapes (voice.md §6.1; no vendor is called): what each
// vendor answer becomes for the index job, and what the spend counts. Synthetic audio and text.

const config = sarvamConfig({ SARVAM_API_KEY: 'sarvam-test-key' });
if (config === undefined) throw new Error('config expected');

/** A minute of a steady tone at 8 kHz: three pieces of 25, 25 and 10 seconds. */
const MINUTE = (() => {
  const samples = new Int16Array(8_000 * 60);
  for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 === 0 ? 2_000 : -2_000;
  return writeWav({ sampleRate: 8_000, channels: 1, samples });
})();

const heard = (transcript: string) =>
  Response.json({ request_id: 'r1', transcript, language_code: 'hi-IN' });

const refusal = (status: number) =>
  Response.json({ error: { code: 'refused', message: 'refused' } }, { status });

function transcriber(respond: () => Response | Promise<Response>) {
  const fetchImpl = stubFetch(respond);
  return {
    fetchImpl,
    speech: recordingTranscriber(
      sarvamSpeech(config, { fetch: fetchImpl, timeoutMs: 1_000 }),
      SARVAM_PRICE,
    ),
  };
}

/** Transcribes `MINUTE`, collecting the pieces' lengths as they are sent. */
async function transcribe(
  speech: ReturnType<typeof transcriber>['speech'],
  signal: AbortSignal = AbortSignal.timeout(10_000),
) {
  const sent: number[] = [];
  const text = await speech.transcribe(MINUTE, {
    contentType: 'audio/wav',
    signal,
    sent: (ms) => sent.push(ms),
  });
  return { text, sent };
}

describe('the vault transcriber', () => {
  it('transcribes a recording piece by piece and counts every piece it sends', async () => {
    const { speech, fetchImpl } = transcriber(() => heard('pump ka stock hai'));
    expect(speech.vendor).toBe('sarvam');
    expect(speech.paisePerHour).toBe(3_000);
    expect(speech.durationMs(MINUTE, 'audio/wav')).toBe(60_000);
    const { text, sent } = await transcribe(speech);
    expect(text).toBe('pump ka stock hai pump ka stock hai pump ka stock hai');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sent.reduce((sum, ms) => sum + ms, 0)).toBe(60_000);
    expect(Math.max(...sent)).toBeLessThanOrEqual(25_000);
  });

  it('records a recording the vendor refuses as unreadable, never to be sent again', async () => {
    for (const status of [400, 413, 422]) {
      await expect(transcribe(transcriber(() => refusal(status)).speech)).rejects.toMatchObject({
        name: 'KnowledgeExtractError',
        reason: 'knowledge_unreadable',
      });
    }
    // A transcript in Devanagari, built from code points so this file holds none (ADR 0014).
    const pump = String.fromCodePoint(0x092a, 0x0902, 0x092a);
    await expect(
      transcribe(transcriber(() => heard(`${pump} ka stock hai`)).speech),
    ).rejects.toBeInstanceOf(KnowledgeExtractError);
  });

  it('leaves a vendor that is busy, failing or not set up to the queue’s retries', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const failed = transcribe(transcriber(() => refusal(status)).speech);
      await expect(failed).rejects.toBeInstanceOf(DomainError);
      await expect(failed).rejects.toMatchObject({ code: 'integration_unavailable' });
    }
    const unreachable = transcriber(() => Promise.reject(new TypeError('fetch failed')));
    await expect(transcribe(unreachable.speech)).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
  });

  it('stops when the reading is out of time, sending nothing more', async () => {
    const { speech, fetchImpl } = transcriber(() => heard('never'));
    const stop = new AbortController();
    stop.abort(new Error('out of time'));
    await expect(transcribe(speech, stop.signal)).rejects.toMatchObject({
      reason: 'knowledge_timed_out',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads only a 16-bit WAV', () => {
    const { speech } = transcriber(() => heard('never'));
    expect(() => speech.durationMs(MINUTE, 'audio/mpeg')).toThrow(KnowledgeExtractError);
    expect(() => speech.durationMs(new Uint8Array([1, 2, 3]), 'audio/wav')).toThrow(
      KnowledgeExtractError,
    );
  });

  it('is held to the spend caps: counted at the audio sent, and refused at the cap before a piece goes', async () => {
    const keyValue = memoryKeyValue();
    const provider = createAiProvider({
      claude: undefined,
      voyage: undefined,
      keyValue,
      logger: memoryLogger(),
    });
    const { speech, fetchImpl } = transcriber(() => heard('pump ka stock hai'));
    const call = {
      agent: 'knowledge:index' as const,
      purpose: 'knowledge_transcribe',
      vendor: speech.vendor,
      entityId: null,
      caps: [{ paise: 50_000, entityId: null }],
      part: { name: 'transcribe', capPaise: 60 },
      // A minute at ₹30 an hour.
      maxPaise: 50,
    };
    const paid = (audioMs: number) => (audioMs / 3_600_000) * speech.paisePerHour;
    await provider.metered(call, (spend) =>
      speech.transcribe(MINUTE, {
        contentType: 'audio/wav',
        signal: AbortSignal.timeout(10_000),
        sent: (ms) => {
          spend(paid(ms));
        },
      }),
    );
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect(await keyValue.get(`ai:spend:knowledge:index:part:transcribe:${day}`)).toBe('50');
    // A second minute would pass transcribing's own cap of 60 paise: refused, nothing sent.
    fetchImpl.mockClear();
    await expect(
      provider.metered(call, (spend) =>
        speech.transcribe(MINUTE, {
          contentType: 'audio/wav',
          signal: AbortSignal.timeout(10_000),
          sent: (ms) => {
            spend(paid(ms));
          },
        }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'agent_spend_cap_reached', scope: 'part' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('vaultTranscriber', () => {
  const KEY = { SARVAM_API_KEY: 'sarvam-test-key' };

  it('is not set up without the switch, whatever the key: the key alone serves the benchmark', () => {
    expect(vaultTranscriber(KEY)).toBeUndefined();
    expect(vaultTranscriber({ ...KEY, KNOWLEDGE_TRANSCRIBE: 'off' })).toBeUndefined();
    expect(vaultTranscriber({ ...KEY, KNOWLEDGE_TRANSCRIBE: 'yes' })).toBeUndefined();
    expect(vaultTranscriber({ KNOWLEDGE_TRANSCRIBE: 'on' })).toBeUndefined();
    expect(vaultTranscriber({ ...KEY, KNOWLEDGE_TRANSCRIBE: 'on' })?.vendor).toBe('sarvam');
  });
});
