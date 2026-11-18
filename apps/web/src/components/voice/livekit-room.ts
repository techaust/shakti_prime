import type {
  AskSourceLabelDto,
  VoiceDraft,
  VoiceRoomMessage,
  VoiceSessionResponse,
} from '@shakti/contracts';
import { PLAYBOOK_AUDIENCE_VALUES, PLAYBOOK_TYPE_VALUES } from '../../screens/contract-values';
import {
  ASK_SOURCE_KIND_VALUES,
  VOICE_END_REASON_VALUES,
  VOICE_STATE_VALUES,
  VOICE_TOPIC,
} from '../../screens/voice-values';
import type { VoiceConnection, VoiceRoom } from './room';

/** A participant as the adapter reads it: only the voice worker (LiveKit's agent kind) speaks. */
export interface LiveKitParticipant {
  readonly isAgent: boolean;
}

/** A track the room hands the page; Shakti's voice is the worker's audio track. */
export interface LiveKitRemoteTrack {
  readonly kind: string;
  attach(): HTMLMediaElement;
  detach(): HTMLMediaElement[];
}

/**
 * The part of `livekit-client`'s `Room` the adapter uses, by its event names. `room.ts` hands the
 * real module in, so the compiler holds the real `Room` to this shape; the tests hand a fake.
 */
export interface LiveKitRoom {
  readonly canPlaybackAudio: boolean;
  readonly localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
    publishData(data: Uint8Array, options: { reliable: boolean; topic: string }): Promise<void>;
  };
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  startAudio(): Promise<void>;
  on(
    event: 'dataReceived',
    listener: (
      payload: Uint8Array,
      participant?: LiveKitParticipant,
      kind?: unknown,
      topic?: string,
    ) => void,
  ): unknown;
  on(
    event: 'trackSubscribed',
    listener: (
      track: LiveKitRemoteTrack,
      publication: unknown,
      participant: LiveKitParticipant,
    ) => void,
  ): unknown;
  on(event: 'trackUnsubscribed', listener: (track: LiveKitRemoteTrack) => void): unknown;
  on(event: 'reconnecting' | 'reconnected' | 'disconnected', listener: () => void): unknown;
  on(event: 'audioPlaybackChanged', listener: (playing: boolean) => void): unknown;
}

export interface LiveKitClient {
  Room: new (options?: {
    audioCaptureDefaults?: {
      echoCancellation?: boolean;
      noiseSuppression?: boolean;
      autoGainControl?: boolean;
    };
  }) => LiveKitRoom;
}

/** Calls each handler as it is added with what came before it, so nothing early is lost. */
class Channel<T> {
  private readonly handlers: ((value: T) => void)[] = [];
  private readonly early: T[] = [];

  add(handler: (value: T) => void): void {
    this.handlers.push(handler);
    for (const value of this.early.splice(0)) handler(value);
  }

  emit(value: T): void {
    if (this.handlers.length === 0) this.early.push(value);
    for (const handler of this.handlers) handler(value);
  }
}

/** The longest caption (`VoiceRoomMessage`). */
const CAPTION_MAX = 2_000;
/** The most cited records one answer shows (`VoiceRoomMessage`). */
const CARDS_MAX = 50;

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return (values as readonly unknown[]).includes(value);
}

function isText(value: unknown, max = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === 'string' && value !== '' && value.length <= max;
}

function isCard(value: unknown): value is AskSourceLabelDto {
  return (
    isFields(value) &&
    isOneOf(ASK_SOURCE_KIND_VALUES, value.kind) &&
    isText(value.id) &&
    (value.label === null || typeof value.label === 'string') &&
    (value.entityId === null || Number.isInteger(value.entityId)) &&
    (value.accountId === null || isText(value.accountId))
  );
}

function isDraft(value: unknown): value is VoiceDraft {
  return (
    isFields(value) &&
    isText(value.id) &&
    isOneOf(PLAYBOOK_TYPE_VALUES, value.type) &&
    isOneOf(PLAYBOOK_AUDIENCE_VALUES, value.audience) &&
    isText(value.title) &&
    isText(value.text)
  );
}

/**
 * The worker's message, when it has the shape the page reads (`VoiceRoomMessage`), else nothing:
 * every value that picks a sentence or a colour is one the page knows. Checked by hand, since
 * the contracts' checks load Zod, which no page carries.
 */
function readMessage(payload: Uint8Array): VoiceRoomMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return undefined;
  }
  if (!isFields(value)) return undefined;
  switch (value.type) {
    case 'caption':
      return isOneOf(['person', 'shakti'], value.speaker) &&
        isText(value.text, CAPTION_MAX) &&
        typeof value.final === 'boolean'
        ? { type: 'caption', speaker: value.speaker, text: value.text, final: value.final }
        : undefined;
    case 'state':
      return isOneOf(VOICE_STATE_VALUES, value.state)
        ? { type: 'state', state: value.state }
        : undefined;
    case 'cards':
      return Array.isArray(value.cards) &&
        value.cards.length <= CARDS_MAX &&
        value.cards.every(isCard)
        ? { type: 'cards', cards: value.cards }
        : undefined;
    case 'draft':
      return isDraft(value.draft) ? { type: 'draft', draft: value.draft } : undefined;
    case 'minutes':
      return Number.isInteger(value.minutesLeft) &&
        typeof value.minutesLeft === 'number' &&
        value.minutesLeft >= 0
        ? { type: 'minutes', minutesLeft: value.minutesLeft }
        : undefined;
    case 'ended':
      return isOneOf(VOICE_END_REASON_VALUES, value.reason)
        ? { type: 'ended', reason: value.reason }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * The session's LiveKit room behind `VoiceRoom` (`livekit-client`): joins with the session's join
 * token, publishes the person's microphone when the page turns it on, plays the worker's voice,
 * reads the worker's messages on the data channel (`VOICE_DATA_TOPIC`, from the agent only,
 * checked) and sends the page's on it, reliable. LiveKit's reconnect
 * states become the page's own: reconnecting, connected again, or lost when the room drops without
 * the page leaving. Leaving disconnects, which stops the microphone, and takes the voice off the
 * page. A join that fails leaves nothing behind.
 */
export async function liveKitVoiceRoom(
  deps: {
    client: LiveKitClient;
    /** Where Shakti's voice is mounted: the page's body. */
    speaker: { append(element: HTMLMediaElement): void };
  },
  livekit: VoiceSessionResponse['livekit'],
): Promise<VoiceRoom> {
  const room = new deps.client.Room({
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const messages = new Channel<VoiceRoomMessage>();
  const connection = new Channel<VoiceConnection>();
  const sound = new Channel<boolean>();
  const voices = new Set<LiveKitRemoteTrack>();
  let leaving = false;

  function silence(track: LiveKitRemoteTrack): void {
    for (const element of track.detach()) element.remove();
    voices.delete(track);
  }

  function silenceAll(): void {
    for (const track of [...voices]) silence(track);
  }

  room.on('dataReceived', (payload, participant, _kind, topic) => {
    if (leaving || topic !== VOICE_TOPIC || participant?.isAgent !== true) return;
    const message = readMessage(payload);
    if (message !== undefined) messages.emit(message);
  });
  room.on('trackSubscribed', (track, _publication, participant) => {
    if (track.kind !== 'audio' || !participant.isAgent) return;
    voices.add(track);
    deps.speaker.append(track.attach());
  });
  room.on('trackUnsubscribed', (track) => {
    if (voices.has(track)) silence(track);
  });
  room.on('reconnecting', () => {
    if (!leaving) connection.emit('reconnecting');
  });
  room.on('reconnected', () => {
    if (!leaving) connection.emit('connected');
  });
  room.on('disconnected', () => {
    if (leaving) return;
    leaving = true;
    silenceAll();
    connection.emit('lost');
  });
  room.on('audioPlaybackChanged', (playing) => {
    sound.emit(!playing);
  });

  try {
    await room.connect(livekit.url, livekit.participantToken);
  } catch (error) {
    leaving = true;
    silenceAll();
    await room.disconnect().catch(() => undefined);
    throw error;
  }
  if (!room.canPlaybackAudio) sound.emit(true);

  return {
    onMessage: (handler) => {
      messages.add(handler);
    },
    onConnection: (handler) => {
      connection.add(handler);
    },
    onSoundBlocked: (handler) => {
      sound.add(handler);
    },
    async startSound() {
      await room.startAudio();
    },
    async send(message) {
      if (leaving) return;
      const data = new TextEncoder().encode(JSON.stringify(message));
      await room.localParticipant.publishData(data, { reliable: true, topic: VOICE_TOPIC });
    },
    async setMicrophone(on) {
      if (leaving) return;
      await room.localParticipant.setMicrophoneEnabled(on);
    },
    async leave() {
      if (leaving) return;
      leaving = true;
      silenceAll();
      await room.disconnect();
    },
  };
}
