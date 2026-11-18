import type { VoicePageMessage, VoiceRoomMessage, VoiceSessionResponse } from '@shakti/contracts';

/** The room's connection as the page shows it: joined, finding its way back, or gone. */
export type VoiceConnection = 'connected' | 'reconnecting' | 'lost';

/**
 * The session's room as `/voice` needs it (docs/03-roadmap-appendix/phase2.md §7.5): the person's
 * microphone on or off, the worker's messages in (captions, the light, cards, drafts, minutes,
 * the end), the page's out (typed questions, push-to-talk, the drafts ask), the connection's
 * state, whether the browser holds Shakti's voice until the person allows sound, and leaving.
 *
 * The page talks only to this port. `voiceRoomConnector()` gives the LiveKit room
 * (`livekit-room.ts` over `livekit-client`, both loaded when a talk starts), or the room a test
 * installed at `window.shaktiVoiceRoom`: the journeys put a fake room there.
 */
export interface VoiceRoom {
  onMessage(handler: (message: VoiceRoomMessage) => void): void;
  onConnection(handler: (connection: VoiceConnection) => void): void;
  /** True while the browser holds Shakti's voice until the person turns sound on. */
  onSoundBlocked(handler: (blocked: boolean) => void): void;
  /** Turns sound on after the browser held it; called from the person's tap. */
  startSound(): Promise<void>;
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

/**
 * The LiveKit room. Its adapter and `livekit-client` load only here, when a talk starts, so no
 * page carries them in its first load, `/voice` included.
 */
const connectLiveKit: ConnectVoiceRoom = async (livekit) => {
  const [{ liveKitVoiceRoom }, client] = await Promise.all([
    import('./livekit-room'),
    import('livekit-client'),
  ]);
  return liveKitVoiceRoom({ client, speaker: document.body }, livekit);
};

/** The room a test installed, or LiveKit's. */
export function voiceRoomConnector(): ConnectVoiceRoom {
  return window.shaktiVoiceRoom ?? connectLiveKit;
}

/** Whether this browser can hold a talk: a microphone it may ask for, and real-time audio. */
export function voiceSupported(): boolean {
  if (window.shaktiVoiceRoom !== undefined) return true;
  // `mediaDevices` is missing outside a secure page, though the DOM types always declare it.
  return (
    typeof window.RTCPeerConnection === 'function' &&
    'mediaDevices' in navigator &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}
