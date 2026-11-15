import { MAX_AUDIO_MS, type FileRejectReason } from '@shakti/contracts';
import { durationMs, readWav, writeWav } from '../../integrations/voice/recording';

export type AudioCheck =
  | { ok: true; sanitising: 'audio_checked'; bytes: Uint8Array }
  | { ok: false; reason: FileRejectReason };

/**
 * A vault recording (K3): a 16-bit PCM WAV of one or two channels at 8 to 48 kHz, as V1's
 * `readWav()` reads it, no longer than `MAX_AUDIO_MS` (checked again when it is read). It is kept
 * written afresh from its samples alone, so no chunk but the format and the audio survives (a
 * `LIST` chunk can name the person or the device that recorded it). Anything else is refused: a
 * WAV of another encoding, or an MP3, M4A or OGG renamed, as unreadable.
 */
export function checkRecording(bytes: Uint8Array): AudioCheck {
  let audio: ReturnType<typeof readWav>;
  try {
    audio = readWav(bytes);
  } catch {
    return { ok: false, reason: 'file_unreadable' };
  }
  if (durationMs(audio) > MAX_AUDIO_MS) return { ok: false, reason: 'file_audio_too_long' };
  return { ok: true, sanitising: 'audio_checked', bytes: writeWav(audio) };
}
