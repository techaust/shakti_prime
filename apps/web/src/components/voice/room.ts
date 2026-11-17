import type { VoicePageMessage, VoiceRoomMessage, VoiceSessionResponse } from '@shakti/contracts';

/**
 * The session's room as `/voice` needs it (docs/03-roadmap-appendix/phase2.md §7.5): the person's
 * microphone on or off, the worker's messages in (captions, the light, cards, drafts, minutes,
 * the end), the page's out (typed questions, push-to-talk, the drafts ask), and leaving.
 *
 * The browser's LiveKit client is not installed (it waits for the owner's go-ahead), so the page
 * reaches the room only through `window.shaktiVoiceRoom`, the one place a connector is installed:
 * the journeys put a fake room there, and the LiveKit connector goes there once its package is
 * approved. Without one, a session answers "not set up" before the microphone is touched.
 */
export interface VoiceRoom {
  onMessage(handler: (message: VoiceRoomMessage) => void): void;
  send(message: VoicePageMessage): Promise<void>;
  /** Turns the microphone on or off; push-to-talk holds it on while the button is held. */
  setMicrophone(on: boolean): Promise<void>;
  leave(): Promise<void>;
}

export type ConnectVoiceRoom = (livekit: VoiceSessionResponse['livekit']) => Promise<VoiceRoom>;

declare global {
  interface Window {
    shaktiVoiceRoom?: ConnectVoiceRoom;
  }
}

/** The installed connector, or one that says voice is not set up in this browser yet. */
export function voiceRoomConnector(): ConnectVoiceRoom {
  return window.shaktiVoiceRoom ?? (() => Promise.reject(new Error('voice_unavailable')));
}
