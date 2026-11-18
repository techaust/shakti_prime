import type {
  AskSourceKind,
  VOICE_DATA_TOPIC,
  VoiceRoomMessage,
  VoiceState,
} from '@shakti/contracts';

// The voice room's contract values the browser reads, copied like those of `contract-values.ts`
// (no page loads Zod) and kept in a module of their own, which only the LiveKit room loads when a
// talk starts, so no other page's first load grows. `contract-values.test.ts` keeps each equal to
// the contract's own, in the same order.

/** The room's data channel topic the voice worker and `/voice` speak on (`VOICE_DATA_TOPIC`). */
export const VOICE_TOPIC = 'shakti' satisfies typeof VOICE_DATA_TOPIC;

/** What the voice worker is doing, as the listening light shows it (`VOICE_STATES`). */
export const VOICE_STATE_VALUES = [
  'listening',
  'thinking',
  'speaking',
  'push_to_talk',
] as const satisfies readonly VoiceState[];

/** Why the voice worker ended a talk (`VOICE_END_REASONS`). */
export const VOICE_END_REASON_VALUES = [
  'time_up',
  'day_limit',
  'ended',
  'failed',
] as const satisfies readonly Extract<VoiceRoomMessage, { type: 'ended' }>['reason'][];

/** The records an answer cites (`ASK_SOURCE_KINDS`). */
export const ASK_SOURCE_KIND_VALUES = [
  'knowledge_file',
  'playbook_directive',
  'pipeline_stage',
  'opportunity',
  'quote',
  'sales_order',
  'account',
  'item',
] as const satisfies readonly AskSourceKind[];
