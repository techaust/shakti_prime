import { z } from 'zod';
import callRecordingNotice from './voice/call-recording-notice.json';
import { SCRIPT_LANGUAGES } from './index';

/**
 * Voice prompts (docs/08-design-system.md §11.4 and §11.5, ADR 0014): what is said to a customer
 * on a call, in Roman-script Hinglish and in English, the customer's `preferred_language` picking
 * the variant. Each lives in its JSON file beside this one, which the copy lint reads.
 */
export const VoicePromptSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    hinglish: z.string().min(1).max(400),
    en: z.string().min(1).max(400),
  })
  .strict();
export type VoicePrompt = z.infer<typeof VoicePromptSchema>;

/**
 * The call-recording notice (LAW-3, `WORKSHOP_DEFAULTS.calling.recordingNotice`): played by the
 * company's Exotel flow before the caller is joined, or read by the caller as the first line of
 * the script card while no flow can be attached to a click-to-dial call.
 */
export const CALL_RECORDING_NOTICE: VoicePrompt = VoicePromptSchema.parse(callRecordingNotice);

/** The prompts by name. */
export const VOICE_PROMPTS = { call_recording_notice: CALL_RECORDING_NOTICE } as const;

export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];
