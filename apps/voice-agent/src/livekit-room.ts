import { VOICE_DATA_TOPIC, VoicePageMessage, VoiceRoomMessage } from '@shakti/contracts';
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteParticipant,
  type RemoteTrack,
  type Room,
} from '@livekit/rtc-node';
import type { SpeechChunk } from '@shakti/voice';
import { AUDIO_IN_SAMPLE_RATE, type RoomPort } from './room';

/** The speech's sample rate, as the speech service streams it (16-bit PCM, mono). */
const SPEECH_SAMPLE_RATE_PATTERN = /rate=(\d+)/;

/** The person's identity in the room, as the BOS signs their join token. */
function isPerson(participant: RemoteParticipant | undefined): boolean {
  return participant?.identity.startsWith('user:') === true;
}

/**
 * The LiveKit room behind `RoomPort` (`@livekit/rtc-node`): the person's microphone as 16 kHz
 * mono frames, Shakti's speech on one published audio track, messages on the room's data channel
 * (`VOICE_DATA_TOPIC`, reliable), and the report as the worker's own participant metadata, which
 * LiveKit's `participant_left` event carries to the BOS. Not loaded by the tests, which use
 * `fakeRoom()`: this module needs the native LiveKit binding.
 */
export function liveKitRoom(room: Room): RoomPort {
  const local = room.localParticipant;
  if (local === undefined) throw new Error('the worker is not connected to the room');
  const sources = new Map<number, AudioSource>();
  let track: { source: AudioSource; rate: number } | undefined;

  async function speechSource(rate: number): Promise<AudioSource> {
    if (track?.rate === rate) return track.source;
    const known = sources.get(rate);
    if (known !== undefined) return known;
    const source = new AudioSource(rate, 1);
    const published = LocalAudioTrack.createAudioTrack('shakti', source);
    await local?.publishTrack(
      published,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );
    sources.set(rate, source);
    track = { source, rate };
    return source;
  }

  const frames = new AsyncFrames();
  room.on(
    RoomEvent.TrackSubscribed,
    (remote: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
      if (remote.kind !== TrackKind.KIND_AUDIO || !isPerson(participant)) return;
      void frames.read(new AudioStream(remote, AUDIO_IN_SAMPLE_RATE, 1));
    },
  );

  const pageHandlers: ((m: VoicePageMessage) => void)[] = [];
  room.on(
    RoomEvent.DataReceived,
    (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== VOICE_DATA_TOPIC || !isPerson(participant)) return;
      let parsed: ReturnType<typeof VoicePageMessage.safeParse>;
      try {
        parsed = VoicePageMessage.safeParse(JSON.parse(new TextDecoder().decode(payload)));
      } catch {
        return;
      }
      if (!parsed.success) return;
      for (const handler of pageHandlers) handler(parsed.data);
    },
  );
  const leftHandlers: (() => void)[] = [];
  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    if (!isPerson(participant)) return;
    for (const handler of leftHandlers) handler();
  });

  return {
    audioIn: frames,
    onPageMessage: (handler) => {
      pageHandlers.push(handler);
    },
    onPersonLeft: (handler) => {
      leftHandlers.push(handler);
    },
    async play(chunk: SpeechChunk) {
      const rate = Number(SPEECH_SAMPLE_RATE_PATTERN.exec(chunk.mimeType)?.[1] ?? '22050');
      const source = await speechSource(rate);
      const samples = new Int16Array(
        chunk.audio.buffer.slice(
          chunk.audio.byteOffset,
          chunk.audio.byteOffset + chunk.audio.byteLength,
        ),
      );
      await source.captureFrame(new AudioFrame(samples, rate, 1, samples.length));
    },
    stopSpeech() {
      track?.source.clearQueue();
    },
    async send(message) {
      const data = new TextEncoder().encode(JSON.stringify(VoiceRoomMessage.parse(message)));
      await local.publishData(data, { reliable: true, topic: VOICE_DATA_TOPIC });
    },
    async report(report) {
      await local.updateMetadata(JSON.stringify(report));
    },
    async leave() {
      frames.close();
      await room.disconnect();
    },
  };
}

/** The person's audio frames, from each of their audio tracks in turn. */
class AsyncFrames implements AsyncIterable<Int16Array> {
  private readonly items: Int16Array[] = [];
  private readonly waiting: ((r: IteratorResult<Int16Array>) => void)[] = [];
  private done = false;

  async read(stream: AudioStream): Promise<void> {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || this.done) return;
      this.push(value.data);
    }
  }

  private push(samples: Int16Array): void {
    const next = this.waiting.shift();
    if (next === undefined) this.items.push(samples);
    else next({ value: samples, done: false });
  }

  close(): void {
    this.done = true;
    for (const next of this.waiting.splice(0)) next({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<Int16Array> {
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
