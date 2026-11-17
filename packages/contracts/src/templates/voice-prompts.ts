import { z } from 'zod';
import callRecordingNotice from './voice/call-recording-notice.json';
import voiceGreetingAsk from './voice/voice-greeting-ask.json';
import voiceGreetingTeach from './voice/voice-greeting-teach.json';
import voiceTimeUp from './voice/voice-time-up.json';
import voiceDayLimit from './voice/voice-day-limit.json';
import voiceNetworkWeak from './voice/voice-network-weak.json';
import voiceAnswerFailed from './voice/voice-answer-failed.json';
import voiceDraftsReady from './voice/voice-drafts-ready.json';
import voiceDraftsFailed from './voice/voice-drafts-failed.json';
import { type SCRIPT_LANGUAGES } from './index';

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

/**
 * What Talk to Shakti says on its own (docs/03-roadmap-appendix/phase2.md §7.5): its greetings,
 * the end of a session, a weak connection, a question it could not answer and the Teach drafts.
 * The voice worker speaks the Hinglish line (ADR 0014); every reply between them is the model's.
 */
export const TALK_PROMPTS = {
  voice_greeting_ask: VoicePromptSchema.parse(voiceGreetingAsk),
  voice_greeting_teach: VoicePromptSchema.parse(voiceGreetingTeach),
  voice_time_up: VoicePromptSchema.parse(voiceTimeUp),
  voice_day_limit: VoicePromptSchema.parse(voiceDayLimit),
  voice_network_weak: VoicePromptSchema.parse(voiceNetworkWeak),
  voice_answer_failed: VoicePromptSchema.parse(voiceAnswerFailed),
  voice_drafts_ready: VoicePromptSchema.parse(voiceDraftsReady),
  voice_drafts_failed: VoicePromptSchema.parse(voiceDraftsFailed),
} as const satisfies Record<string, VoicePrompt>;
export type TalkPromptName = keyof typeof TALK_PROMPTS;

/** The prompts by name. */
export const VOICE_PROMPTS = {
  call_recording_notice: CALL_RECORDING_NOTICE,
  ...TALK_PROMPTS,
} as const;

export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];
