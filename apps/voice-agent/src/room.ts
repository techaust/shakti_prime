import type { VoicePageMessage, VoiceRoomMessage, VoiceWorkerReport } from '@shakti/contracts';
import type { SpeechChunk } from '@shakti/voice';

/**
 * The room as the session sees it (docs/03-roadmap-appendix/phase2.md §7.5): the person's audio
 * coming in, the page's messages, Shakti's speech and messages going out, and the report LiveKit
 * carries to the BOS when the worker leaves. `livekit-room.ts` implements it over the LiveKit
 * room; the tests use `fakeRoom()`, so no test needs a room or a vendor.
 */
export interface RoomPort {
  /** The person's speech: 16-bit PCM, mono, at `AUDIO_IN_SAMPLE_RATE`, as it is captured. */
  readonly audioIn: AsyncIterable<Int16Array>;
  /** Messages from the `/voice` page, each read by the contract before it reaches here. */
  onPageMessage(handler: (message: VoicePageMessage) => void): void;
  /** Called once when the person is in the room: at once when they already are. */
  onPersonJoined(handler: () => void): void;
  /** Called once when the person leaves the room, or the room closes under the worker. */
  onPersonLeft(handler: () => void): void;
  /** Plays one piece of Shakti's speech; resolves once it is queued. */
  play(chunk: SpeechChunk): Promise<void>;
  /** Stops Shakti's speech at once (the person spoke over it). */
  stopSpeech(): void;
  send(message: VoiceRoomMessage): Promise<void>;
  /** The session's report, carried to the BOS by LiveKit's event when the worker leaves. */
  report(report: VoiceWorkerReport): Promise<void>;
  leave(): Promise<void>;
}

/** The person's audio is read at this rate: what the speech service takes. */
export const AUDIO_IN_SAMPLE_RATE = 16_000;

/** A queue the fake room's audio comes through, closed by `endAudio()`. */
class Feed<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiting: ((r: IteratorResult<T>) => void)[] = [];
  private done = false;

  push(item: T): void {
    const next = this.waiting.shift();
    if (next === undefined) this.items.push(item);
    else next({ value: item, done: false });
  }

  close(): void {
    this.done = true;
    for (const next of this.waiting.splice(0)) next({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiting.push(resolve));
      },
    };
  }
}

/**
 * A room for the tests: records what the session sends and plays, and lets a test speak. The
 * person is in it from the start unless `personPresent` is false; then `personJoins()` brings them.
 */
export function fakeRoom(options: { personPresent?: boolean } = {}) {
  const audio = new Feed<Int16Array>();
  const pageHandlers: ((m: VoicePageMessage) => void)[] = [];
  const joinedHandlers: (() => void)[] = [];
  const leftHandlers: (() => void)[] = [];
  let present = options.personPresent ?? true;
  const room = {
    sent: [] as VoiceRoomMessage[],
    played: [] as SpeechChunk[],
    stops: 0,
    reports: [] as VoiceWorkerReport[],
    left: false,
    audioIn: audio as AsyncIterable<Int16Array>,
    onPageMessage: (handler: (m: VoicePageMessage) => void) => {
      pageHandlers.push(handler);
    },
    onPersonJoined: (handler: () => void) => {
      if (present) handler();
      else joinedHandlers.push(handler);
    },
    onPersonLeft: (handler: () => void) => {
      leftHandlers.push(handler);
    },
    play(chunk: SpeechChunk) {
      room.played.push(chunk);
      return Promise.resolve();
    },
    stopSpeech() {
      room.stops += 1;
    },
    send(message: VoiceRoomMessage) {
      room.sent.push(message);
      return Promise.resolve();
    },
    report(report: VoiceWorkerReport) {
      room.reports.push(report);
      return Promise.resolve();
    },
    leave() {
      room.left = true;
      audio.close();
      return Promise.resolve();
    },
    /** The person speaks a frame of audio. */
    speak(samples: Int16Array) {
      audio.push(samples);
    },
    endAudio() {
      audio.close();
    },
    /** The page sends a message. */
    page(message: VoicePageMessage) {
      for (const handler of pageHandlers) handler(message);
    },
    personJoins() {
      present = true;
      for (const handler of joinedHandlers.splice(0)) handler();
    },
    personLeaves() {
      for (const handler of leftHandlers) handler();
    },
  };
  return room;
}
