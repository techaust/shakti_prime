import type { RecordingTranscriber } from '@shakti/domain';
import { SARVAM_PRICE } from '../../integrations/voice/benchmark/stand-in-set';
import { sarvamConfig, sarvamSpeech } from '@shakti/voice';
import { recordingTranscriber } from '../knowledge/transcriber';

/**
 * Whether call recordings may go to the speech vendor for the Caller Co-pilot's summaries:
 * `CALL_TRANSCRIBE=on`, read at run time and off by default. It is a switch of its own beside
 * the vault's `KNOWLEDGE_TRANSCRIBE`, since a call recording holds a customer's voice: it is
 * turned on once the owner has approved the vendor's data terms for calls and the company's
 * recording notice is in use (docs/03-roadmap-appendix/phase2.md §7.3, SECURITY §5).
 */
export function callTranscribeOn(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.CALL_TRANSCRIBE?.trim() === 'on';
}

/**
 * Sarvam's speech to text for call recordings, through V1's `transcribeRecording()` as the vault
 * uses it (a 16-bit WAV, Hindi in Roman script), when the switch is on and `SARVAM_API_KEY` is set;
 * otherwise none, and a recorded call gets no summary.
 */
export function callTranscriber(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RecordingTranscriber | undefined {
  if (!callTranscribeOn(env)) return undefined;
  const config = sarvamConfig(env);
  return config === undefined
    ? undefined
    : recordingTranscriber(sarvamSpeech(config), SARVAM_PRICE);
}
