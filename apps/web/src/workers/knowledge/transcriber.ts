import { DomainError } from '@shakti/contracts';
import { KnowledgeExtractError, type RecordingTranscriber } from '@shakti/domain';
import { ProviderError } from '../../integrations/http';
import { SARVAM_PRICE } from '../../integrations/voice/benchmark/stand-in-set';
import type { SpeechPrice } from '../../integrations/voice/benchmark/measures';
import type { SpeechToText } from '../../integrations/voice/ports';
import {
  durationMs,
  readWav,
  transcribeRecording,
  WAV_MIME_TYPES,
} from '../../integrations/voice/recording';
import { sarvamConfig, sarvamSpeech } from '../../integrations/voice/sarvam';

/**
 * The language a vault recording is transcribed in: Hindi, which Sarvam's `translit` mode answers
 * in Roman script and which carries the Hinglish and Indian English the group speaks, as the voice
 * benchmark's set does (docs/04-architecture-appendix/voice.md §5).
 */
export const VAULT_AUDIO_LANGUAGE = 'hi-IN';

/**
 * Pieces of a recording sent at once: a 25 MB WAV is at most about 60 pieces of 25 seconds, which
 * four at a time take well inside the index route's time.
 */
export const VAULT_TRANSCRIBE_CONCURRENCY = 4;

/** A vendor refusal that reading again cannot change: the audio itself was refused. */
function refusedAudio(error: ProviderError): boolean {
  if (error.failure === 'invalid_response') return true;
  return (
    error.failure === 'http' &&
    !error.retryable &&
    error.status !== undefined &&
    error.status !== 401 &&
    error.status !== 403
  );
}

/**
 * A vault recording's speech service (K3) for the index job: V1's `transcribeRecording()` over a
 * batch adapter, a 16-bit WAV only (MP3, M4A and OGG would need a decoder, which the BOS does not
 * have, so the upload refuses them). Its errors are the job's: a recording that cannot be read or
 * a transcript that is not Roman script is `knowledge_unreadable`, a reading out of time
 * `knowledge_timed_out`, and a vendor that fails `integration_unavailable`, delivered again.
 */
export function recordingTranscriber(stt: SpeechToText, price: SpeechPrice): RecordingTranscriber {
  return {
    vendor: stt.vendor,
    paisePerHour: price.sttRupeesPerHour * 100,

    durationMs(bytes, contentType) {
      if (!WAV_MIME_TYPES.includes(contentType.toLowerCase())) {
        throw new KnowledgeExtractError('knowledge_unreadable', 'a recording is read as a WAV');
      }
      try {
        return durationMs(readWav(bytes));
      } catch (error) {
        throw new KnowledgeExtractError('knowledge_unreadable', 'the recording could not be read', {
          cause: error,
        });
      }
    },

    async transcribe(bytes, options) {
      try {
        const transcript = await transcribeRecording(
          bytes,
          {
            mimeType: options.contentType,
            languageCode: VAULT_AUDIO_LANGUAGE,
            concurrency: VAULT_TRANSCRIBE_CONCURRENCY,
            signal: options.signal,
            onPiece: options.sent,
          },
          stt,
        );
        return transcript.text;
      } catch (error) {
        if (options.signal.aborted) {
          throw new KnowledgeExtractError('knowledge_timed_out', 'transcribing ran out of time', {
            cause: error,
          });
        }
        if (error instanceof ProviderError) {
          if (refusedAudio(error)) {
            throw new KnowledgeExtractError(
              'knowledge_unreadable',
              'the speech service refused it',
              {
                cause: error,
              },
            );
          }
          throw new DomainError(
            'integration_unavailable',
            'the speech service did not answer',
            {},
            { cause: error },
          );
        }
        throw new KnowledgeExtractError('knowledge_unreadable', 'the recording could not be read', {
          cause: error,
        });
      }
    },
  };
}

/** Sarvam's speech to text when `SARVAM_API_KEY` is set; otherwise none, and a recording waits. */
export function vaultTranscriber(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RecordingTranscriber | undefined {
  const config = sarvamConfig(env);
  return config === undefined
    ? undefined
    : recordingTranscriber(sarvamSpeech(config), SARVAM_PRICE);
}
