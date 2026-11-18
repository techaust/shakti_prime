import type { VoiceRoomMessage } from '@shakti/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  liveKitVoiceRoom,
  type LiveKitParticipant,
  type LiveKitRemoteTrack,
  type LiveKitRoom,
} from './livekit-room';
import { voiceRoomConnector, voiceSupported, type VoiceConnection, type VoiceRoom } from './room';

// The page's LiveKit room (docs/03-roadmap-appendix/phase2.md §7.5) against a small fake of the
// part of `livekit-client` it uses: no network, no room, no browser.
vi.mock('livekit-client', () => ({ Room: FakeLiveKitRoom }));

/**
 * A stand-in for the part of `livekit-client` the adapter uses, for the unit tests: no network
 * and no browser. The test plays LiveKit's side with `emit`, and reads what the adapter did.
 */
class FakeLiveKitRoom implements LiveKitRoom {
  static rooms: FakeLiveKitRoom[] = [];

  canPlaybackAudio = true;
  connectFails: Error | undefined;
  joined: { url: string; token: string } | undefined;
  disconnects = 0;
  audioStarts = 0;
  microphone: boolean[] = [];
  published: { text: string; options: { reliable: boolean; topic: string } }[] = [];
  private readonly listeners = new Map<string, ((...args: never[]) => void)[]>();

  constructor(readonly options?: unknown) {
    FakeLiveKitRoom.rooms.push(this);
  }

  readonly localParticipant = {
    setMicrophoneEnabled: (enabled: boolean): Promise<undefined> => {
      this.microphone.push(enabled);
      return Promise.resolve(undefined);
    },
    publishData: (data: Uint8Array, options: { reliable: boolean; topic: string }) => {
      this.published.push({ text: new TextDecoder().decode(data), options });
      return Promise.resolve();
    },
  };

  connect(url: string, token: string): Promise<void> {
    if (this.connectFails !== undefined) return Promise.reject(this.connectFails);
    this.joined = { url, token };
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.disconnects += 1;
    this.emit('disconnected');
    return Promise.resolve();
  }

  startAudio(): Promise<void> {
    this.audioStarts += 1;
    this.canPlaybackAudio = true;
    this.emit('audioPlaybackChanged', true);
    return Promise.resolve();
  }

  on(event: string, listener: (...args: never[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  /** LiveKit raises one of its room events. */
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }

  /** A data message on the room's channel, as JSON. */
  data(message: unknown, from: LiveKitParticipant | undefined, topic = 'shakti'): void {
    const payload = new TextEncoder().encode(
      typeof message === 'string' ? message : JSON.stringify(message),
    );
    this.emit('dataReceived', payload, from, undefined, topic);
  }
}

const agent: LiveKitParticipant = { isAgent: true };
const person: LiveKitParticipant = { isAgent: false };

/** A remote audio track whose page elements the test can count. */
class FakeTrack implements LiveKitRemoteTrack {
  readonly elements: { removed: boolean }[] = [];

  constructor(readonly kind: string) {}

  attach(): HTMLMediaElement {
    const element = {
      removed: false,
      remove() {
        this.removed = true;
      },
    };
    this.elements.push(element);
    return element as unknown as HTMLMediaElement;
  }

  detach(): HTMLMediaElement[] {
    return this.elements.filter((e) => !e.removed) as unknown as HTMLMediaElement[];
  }
}

const livekit = {
  url: 'wss://voice.example.invalid',
  roomName: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0e',
  participantToken: 'join.phrase.for.tests',
  expiresAt: '2026-11-17T10:15:00.000Z',
};

const caption: VoiceRoomMessage = {
  type: 'caption',
  speaker: 'shakti',
  text: 'Ji, bataiye.',
  final: true,
};

function speaker() {
  const mounted: unknown[] = [];
  return {
    mounted,
    append(element: HTMLMediaElement) {
      mounted.push(element);
    },
  };
}

/** Joins the fake room; answers the adapter's room, the fake and where the voice is mounted. */
async function join(options: { canPlaybackAudio?: boolean } = {}) {
  const out = speaker();
  const client = {
    Room: class extends FakeLiveKitRoom {
      override canPlaybackAudio = options.canPlaybackAudio ?? true;
    },
  };
  const room = await liveKitVoiceRoom({ client, speaker: out }, livekit);
  const fake = FakeLiveKitRoom.rooms.at(-1);
  if (fake === undefined) throw new Error('no room was made');
  return { room, fake, out };
}

function listen(room: VoiceRoom) {
  const messages: VoiceRoomMessage[] = [];
  const connection: VoiceConnection[] = [];
  const soundBlocked: boolean[] = [];
  room.onMessage((m) => messages.push(m));
  room.onConnection((c) => connection.push(c));
  room.onSoundBlocked((b) => soundBlocked.push(b));
  return { messages, connection, soundBlocked };
}

beforeEach(() => {
  FakeLiveKitRoom.rooms = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('joining', () => {
  it('joins with the session join phrase and address, and publishes nothing until the microphone is on', async () => {
    const { fake } = await join();
    expect(fake.joined).toEqual({ url: livekit.url, token: livekit.participantToken });
    expect(fake.options).toEqual({
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(fake.microphone).toEqual([]);
    expect(fake.published).toEqual([]);
  });

  it('leaves nothing behind when the join fails', async () => {
    const out = speaker();
    const failing = class extends FakeLiveKitRoom {
      override connectFails = new Error('could not reach the room');
    };
    await expect(
      liveKitVoiceRoom({ client: { Room: failing }, speaker: out }, livekit),
    ).rejects.toThrow('could not reach the room');
    expect(FakeLiveKitRoom.rooms.at(-1)?.disconnects).toBe(1);
  });
});

describe('the microphone', () => {
  it('publishes the microphone when turned on, and mutes it when turned off', async () => {
    const { room, fake } = await join();
    await room.setMicrophone(true);
    await room.setMicrophone(false);
    await room.setMicrophone(true);
    expect(fake.microphone).toEqual([true, false, true]);
  });

  it('passes on the browser refusing the microphone', async () => {
    const { room, fake } = await join();
    fake.localParticipant.setMicrophoneEnabled = () =>
      Promise.reject(new Error('the person said no'));
    await expect(room.setMicrophone(true)).rejects.toThrow('the person said no');
  });
});

describe('the data channel', () => {
  it('hands the page the worker messages, checked, from the agent on the voice topic only', async () => {
    const { room, fake } = await join();
    const { messages } = listen(room);
    fake.data(caption, agent);
    fake.data({ type: 'state', state: 'thinking' }, agent);
    // Not the worker, another topic, broken or unknown messages: dropped.
    fake.data(caption, person);
    fake.data(caption, undefined);
    fake.data(caption, agent, 'other');
    fake.data('{not json', agent);
    fake.data({ type: 'state', state: 'dancing' }, agent);
    fake.data({ type: 'caption', speaker: 'shakti', text: '', final: true }, agent);
    fake.data({ type: 'caption', speaker: 'shakti', text: 'x'.repeat(2_001), final: true }, agent);
    fake.data({ type: 'minutes', minutesLeft: -1 }, agent);
    fake.data({ type: 'ended', reason: 'bored' }, agent);
    fake.data({ type: 'cards', cards: [{ kind: 'invoice', id: 'a', label: null }] }, agent);
    fake.data({ type: 'draft', draft: { id: 'a', type: 'faq', audience: 'everyone' } }, agent);
    fake.data(['caption'], agent);
    expect(messages).toEqual([caption, { type: 'state', state: 'thinking' }]);
  });

  it('keeps only the fields the page reads, of each message it knows', async () => {
    const { room, fake } = await join();
    const { messages } = listen(room);
    const card = {
      kind: 'pipeline_stage',
      id: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8b01',
      label: 'Qualified',
      entityId: 1,
      accountId: null,
    };
    const draft = {
      id: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8b02',
      type: 'faq',
      audience: 'customer',
      title: 'Subsidy timing',
      text: 'The subsidy is paid after the inspection.',
    };
    fake.data({ ...caption, extra: true }, agent);
    fake.data({ type: 'cards', cards: [card] }, agent);
    fake.data({ type: 'draft', draft }, agent);
    fake.data({ type: 'minutes', minutesLeft: 0 }, agent);
    fake.data({ type: 'ended', reason: 'day_limit' }, agent);
    expect(messages).toEqual([
      caption,
      { type: 'cards', cards: [card] },
      { type: 'draft', draft },
      { type: 'minutes', minutesLeft: 0 },
      { type: 'ended', reason: 'day_limit' },
    ]);
  });

  it('keeps the messages that came before the page listened', async () => {
    const { room, fake } = await join();
    fake.data(caption, agent);
    fake.data({ type: 'minutes', minutesLeft: 12 }, agent);
    const { messages } = listen(room);
    expect(messages).toEqual([caption, { type: 'minutes', minutesLeft: 12 }]);
  });

  it('sends the page messages reliably on the voice topic', async () => {
    const { room, fake } = await join();
    await room.send({ type: 'text', text: 'Aur dealers ke liye?' });
    await room.send({ type: 'push_to_talk', held: true });
    await room.send({ type: 'make_drafts' });
    expect(fake.published).toEqual([
      {
        text: '{"type":"text","text":"Aur dealers ke liye?"}',
        options: { reliable: true, topic: 'shakti' },
      },
      { text: '{"type":"push_to_talk","held":true}', options: { reliable: true, topic: 'shakti' } },
      { text: '{"type":"make_drafts"}', options: { reliable: true, topic: 'shakti' } },
    ]);
  });
});

describe("Shakti's voice", () => {
  it("plays the worker's audio on the page, and takes it off when the track goes", async () => {
    const { fake, out } = await join();
    const voice = new FakeTrack('audio');
    fake.emit('trackSubscribed', voice, {}, agent);
    // Another participant's audio, or the worker's video, is not played.
    fake.emit('trackSubscribed', new FakeTrack('audio'), {}, person);
    fake.emit('trackSubscribed', new FakeTrack('video'), {}, agent);
    expect(out.mounted).toEqual(voice.elements);
    expect(voice.elements).toHaveLength(1);
    fake.emit('trackUnsubscribed', voice);
    expect(voice.elements[0]?.removed).toBe(true);
  });

  it('says when the browser holds the sound, and turns it on at the person tap', async () => {
    const { room, fake } = await join({ canPlaybackAudio: false });
    const { soundBlocked } = listen(room);
    expect(soundBlocked).toEqual([true]);
    await room.startSound();
    expect(fake.audioStarts).toBe(1);
    expect(soundBlocked).toEqual([true, false]);
    fake.emit('audioPlaybackChanged', false);
    expect(soundBlocked).toEqual([true, false, true]);
  });
});

describe('the connection', () => {
  it('maps reconnecting, reconnected and a dropped room to the page states', async () => {
    const { room, fake, out } = await join();
    const { connection } = listen(room);
    const voice = new FakeTrack('audio');
    fake.emit('trackSubscribed', voice, {}, agent);
    fake.emit('reconnecting');
    fake.emit('reconnected');
    fake.emit('disconnected');
    expect(connection).toEqual(['reconnecting', 'connected', 'lost']);
    expect(out.mounted).toHaveLength(1);
    expect(voice.elements[0]?.removed).toBe(true);
    // A lost room is not used again.
    await room.setMicrophone(true);
    await room.send({ type: 'make_drafts' });
    expect(fake.microphone).toEqual([]);
    expect(fake.published).toEqual([]);
  });
});

describe('leaving', () => {
  it('disconnects once, takes the voice off the page, and is not reported as a lost connection', async () => {
    const { room, fake } = await join();
    const { connection, messages } = listen(room);
    const voice = new FakeTrack('audio');
    fake.emit('trackSubscribed', voice, {}, agent);
    await room.leave();
    await room.leave();
    expect(fake.disconnects).toBe(1);
    expect(voice.elements[0]?.removed).toBe(true);
    expect(connection).toEqual([]);
    // After leaving, nothing more reaches the page or the room.
    fake.data(caption, agent);
    fake.emit('reconnecting');
    await room.setMicrophone(true);
    await room.send({ type: 'make_drafts' });
    expect(messages).toEqual([]);
    expect(connection).toEqual([]);
    expect(fake.microphone).toEqual([]);
    expect(fake.published).toEqual([]);
  });
});

describe('the connector', () => {
  it('takes the room a test installed in place of LiveKit', () => {
    const installed = vi.fn();
    vi.stubGlobal('window', { shaktiVoiceRoom: installed });
    expect(voiceRoomConnector()).toBe(installed);
    expect(voiceSupported()).toBe(true);
  });

  it('loads LiveKit when a talk starts, and mounts the voice on the page', async () => {
    const out = speaker();
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { body: out });
    const room = await voiceRoomConnector()(livekit);
    const fake = FakeLiveKitRoom.rooms.at(-1);
    expect(fake?.joined).toEqual({ url: livekit.url, token: livekit.participantToken });
    fake?.emit('trackSubscribed', new FakeTrack('audio'), {}, agent);
    expect(out.mounted).toHaveLength(1);
    await room.leave();
    expect(fake?.disconnects).toBe(1);
  });

  it('says a browser without a microphone or real-time audio cannot hold a talk', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
    expect(voiceSupported()).toBe(false);
    vi.stubGlobal('window', { RTCPeerConnection: vi.fn() });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => undefined } });
    expect(voiceSupported()).toBe(true);
  });
});
