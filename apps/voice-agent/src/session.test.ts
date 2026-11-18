import { newId, VoiceRoomMessage, type VoiceDispatchMetadata } from '@shakti/contracts';
import {
  AsyncQueue,
  type ReplyUsage,
  type SpeechChunk,
  type StreamingSpeechToText,
  type StreamingTextToSpeech,
  type SttEvent,
} from '@shakti/voice';
import { describe, expect, it } from 'vitest';
import { said } from './prompts';
import { fakeRoom } from './room';
import {
  END_MARGIN_MS,
  PERSON_JOIN_WAIT_MS,
  VoiceSession,
  type Responder,
  type Timers,
} from './session';
import { WavRecorder } from './wav-recorder';

// The worker on a fake room (docs/03-roadmap-appendix/phase2.md §14, V2): turn timing by step,
// barge-in, the fall back to push-to-talk and text, and the session's own end at its longest
// length and at the day's spend. No vendor, model or BOS is reached: each is a stand-in here.

const NOW = Date.parse('2026-11-17T06:00:00.000Z');

/** A clock a test moves by hand. */
function manualClock() {
  let ms = 0;
  return { now: () => ms, advance: (by: number) => (ms += by) };
}

/** Timers a test fires by hand: every one, or those of one length. */
function manualTimers(): Timers & {
  fire: () => void;
  fireAt: (ms: number) => void;
  pending: () => number[];
} {
  const timers: { fn: () => void; ms: number }[] = [];
  return {
    set: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clear: (t) => {
      const i = timers.indexOf(t as (typeof timers)[number]);
      if (i !== -1) timers.splice(i, 1);
    },
    fire: () => {
      for (const t of timers.splice(0)) t.fn();
    },
    fireAt: (ms) => {
      const due = timers.filter((t) => t.ms === ms);
      for (const t of due) timers.splice(timers.indexOf(t), 1);
      for (const t of due) t.fn();
    },
    pending: () => timers.map((t) => t.ms),
  };
}

function metadata(over: Partial<VoiceDispatchMetadata> = {}): VoiceDispatchMetadata {
  return {
    sessionId: newId(),
    apiBase: 'https://bos.shakti.test/api/v1',
    bosToken: { token: 'a.b.c', expiresAt: new Date(NOW + 300_000).toISOString() },
    mode: 'ask',
    consentRecording: false,
    notAfter: new Date(NOW + 15 * 60_000).toISOString(),
    limits: { minutesRemainingToday: 30, paiseRemainingToday: 20_000, maxSessionMinutes: 15 },
    model: {
      model: 'claude-sonnet-5-5',
      effort: 'low',
      thinking: 'between_tools',
      maxTokens: 400,
      draftMaxTokens: 16_000,
      prices: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      paisePerUsd: 10_400,
      speechPaisePerMinute: 50,
    },
    ...over,
  };
}

/** A speech-to-text stand-in: each stream's events are pushed by the test. */
function fakeStt(options: { failOpen?: boolean } = {}) {
  const streams: AsyncQueue<SttEvent>[] = [];
  const sent: number[] = [];
  let ended = 0;
  const stt: StreamingSpeechToText = {
    vendor: 'fake',
    open: () => {
      if (options.failOpen === true) return Promise.reject(new Error('down'));
      const events = new AsyncQueue<SttEvent>();
      streams.push(events);
      return Promise.resolve({
        send: (audio: Uint8Array) => sent.push(audio.length),
        end: () => {
          ended += 1;
        },
        close: () => {
          events.close();
        },
        events,
      });
    },
  };
  return {
    stt,
    sent,
    ended: () => ended,
    emit: (event: SttEvent) => streams.at(-1)?.push(event),
    fail: () => streams.at(-1)?.fail(new Error('the speech service dropped')),
    streams,
  };
}

/** A text-to-speech stand-in: one chunk per sentence, stamped with the clock. */
function fakeTts(clock: { now: () => number }, delayMs = 0, advance?: (ms: number) => void) {
  const spoken: string[] = [];
  const tts: StreamingTextToSpeech = {
    vendor: 'fake',
    open: () =>
      Promise.resolve({
        async *speak(text: string): AsyncIterable<SpeechChunk> {
          spoken.push(text);
          advance?.(delayMs);
          await Promise.resolve();
          yield { audio: new Uint8Array(4), mimeType: 'audio/L16;rate=22050', atMs: clock.now() };
        },
        close: () => undefined,
      }),
  };
  return { tts, spoken };
}

const NO_USAGE: ReplyUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Lets every pending promise run. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function start(over: {
  responder?: Responder;
  stt?: StreamingSpeechToText | undefined;
  tts?: StreamingTextToSpeech;
  meta?: Partial<VoiceDispatchMetadata>;
  recorder?: WavRecorder;
  wallNow?: number;
  clock?: ReturnType<typeof manualClock>;
  personPresent?: boolean;
}) {
  const room = fakeRoom({ personPresent: over.personPresent ?? true });
  const clock = over.clock ?? manualClock();
  const timers = manualTimers();
  const uploads: Uint8Array[] = [];
  let stopped = 0;
  const session = new VoiceSession({
    room,
    metadata: metadata(over.meta),
    bos: {
      stop: () => {
        stopped += 1;
      },
      uploadRecording: (wav) => {
        uploads.push(wav);
        return Promise.resolve({ fileId: newId(), linked: true });
      },
    },
    responder: over.responder ?? { respond: () => Promise.resolve({}) },
    stt: 'stt' in over ? over.stt : fakeStt().stt,
    tts: over.tts ?? fakeTts(clock).tts,
    clock,
    wallNow: () => over.wallNow ?? NOW,
    timers,
    languageCode: 'hi-IN',
    ...(over.recorder === undefined ? {} : { recorder: over.recorder }),
  });
  const done = session.run();
  return { room, clock, timers, session, done, uploads, stopped: () => stopped };
}

describe('a spoken turn', () => {
  it("is timed by step from the person's end of speech to Shakti's first audio", async () => {
    const clock = manualClock();
    const stt = fakeStt();
    const { tts, spoken } = fakeTts(clock, 120, (ms) => clock.advance(ms));
    const responder: Responder = {
      respond: (_text, turn) => {
        clock.advance(400);
        turn.onSentence('Ji, 5 HP pump stock mein hai.');
        clock.advance(300);
        turn.onSentence('Kal dispatch ho jayega.');
        return Promise.resolve({ usage: { ...NO_USAGE, inputTokens: 1_000_000 } });
      },
    };
    const { room, session } = start({ responder, stt: stt.stt, tts, clock });
    await settle();
    clock.advance(1_000);
    stt.emit({ type: 'speech_start', atMs: clock.now() });
    clock.advance(2_000);
    stt.emit({ type: 'speech_end', atMs: clock.now() });
    clock.advance(200);
    stt.emit({ type: 'final', text: 'pump hai?', languageCode: 'hi-IN', atMs: clock.now() });
    await settle();
    // The turn spent more than the day's ₹200 (below), so the session says so and ends.
    expect(spoken).toEqual([
      said('voice_greeting_ask'),
      'Ji, 5 HP pump stock mein hai.',
      'Kal dispatch ho jayega.',
      said('voice_day_limit'),
    ]);
    // Final 200 ms after the end; the first sentence 400 ms later; its audio 120 ms after it.
    expect(session.turnStats()).toEqual({
      turns: 1,
      steps: {
        final_transcript: { p50Ms: 200, p95Ms: 200 },
        first_sentence: { p50Ms: 400, p95Ms: 400 },
        first_speech: { p50Ms: 420, p95Ms: 420 },
        first_audio: { p50Ms: 1_020, p95Ms: 1_020 },
      },
    });
    expect(room.sent).toContainEqual({
      type: 'caption',
      speaker: 'person',
      text: 'pump hai?',
      final: true,
    });
    // Listening; the greeting; listening; the turn: thinking, speaking, then listening again.
    expect(
      room.sent
        .filter((m) => m.type === 'state')
        .map((m) => m.state)
        .slice(0, 6),
    ).toEqual(['listening', 'speaking', 'listening', 'thinking', 'speaking', 'listening']);
    // Every message is one the page reads.
    for (const message of room.sent) expect(VoiceRoomMessage.safeParse(message).success).toBe(true);
    // A million input tokens at $2 is ₹208 at ₹104 a dollar, over the day's ₹200: the session ends.
    expect(room.reports.at(0)?.costPaise).toBeGreaterThanOrEqual(20_800);
    expect(session.endReason).toBe('day_limit');
  });

  it('stops at once when the person speaks over Shakti', async () => {
    const stt = fakeStt();
    let stoppedTurn: AbortSignal | undefined;
    const responder: Responder = {
      respond: (_text, turn) => {
        stoppedTurn = turn.signal;
        turn.onSentence('Pehli baat yeh hai.');
        // A long reply that waits until it is stopped.
        return new Promise((_resolve, reject) => {
          turn.signal.addEventListener('abort', () => {
            reject(new Error('stopped'));
          });
        });
      },
    };
    const { room, session } = start({ responder, stt: stt.stt });
    await settle();
    stt.emit({ type: 'final', text: 'batao', languageCode: 'hi-IN', atMs: 10 });
    await settle();
    expect(room.sent.some((m) => m.type === 'state' && m.state === 'speaking')).toBe(true);
    stt.emit({ type: 'speech_start', atMs: 20 });
    await settle();
    expect(stoppedTurn?.aborted).toBe(true);
    expect(room.stops).toBe(1);
    expect(session.interruptions).toBe(1);
    // The stopped turn is not counted as a completed one.
    expect(session.turnStats().turns).toBe(0);
  });
});

describe('when the network drops', () => {
  it('falls back to push-to-talk and typed questions, and still answers', async () => {
    const stt = fakeStt();
    const asked: string[] = [];
    const responder: Responder = {
      respond: (text, turn) => {
        asked.push(text);
        turn.onSentence('Theek hai.');
        return Promise.resolve({});
      },
    };
    const { room } = start({ responder, stt: stt.stt });
    await settle();
    stt.fail();
    await settle();
    expect(room.sent).toContainEqual({ type: 'state', state: 'push_to_talk' });
    expect(room.sent).toContainEqual({
      type: 'caption',
      speaker: 'shakti',
      text: said('voice_network_weak'),
      final: true,
    });
    // A typed question is a turn like a spoken one.
    room.page({ type: 'text', text: 'Aaj kitne lead aaye?' });
    await settle();
    expect(asked).toEqual(['Aaj kitne lead aaye?']);
    // Push-to-talk opens a stream while held and settles it when let go.
    const before = stt.streams.length;
    room.page({ type: 'push_to_talk', held: true });
    await settle();
    expect(stt.streams.length).toBe(before + 1);
    room.page({ type: 'push_to_talk', held: false });
    expect(stt.ended()).toBe(1);
    stt.emit({ type: 'final', text: 'aur kal?', languageCode: 'hi-IN', atMs: 5 });
    await settle();
    expect(asked).toEqual(['Aaj kitne lead aaye?', 'aur kal?']);
  });

  it('starts in push-to-talk when no speech service is set up', async () => {
    const { room } = start({ stt: undefined });
    await settle();
    expect(room.sent).toContainEqual({ type: 'state', state: 'push_to_talk' });
  });
});

describe('the end of a session', () => {
  it('comes at its longest length, before the BOS would refuse its token, and says so', async () => {
    const { room, timers, done, stopped } = start({});
    await settle();
    // The session's own end: 15 minutes, less the margin, from now to `notAfter`.
    expect(timers.pending()).toEqual([15 * 60_000 - END_MARGIN_MS]);
    timers.fire();
    await done;
    expect(room.sent.at(-1)).toEqual({ type: 'ended', reason: 'time_up' });
    expect(room.sent).toContainEqual({
      type: 'caption',
      speaker: 'shakti',
      text: said('voice_time_up'),
      final: true,
    });
    expect(room.left).toBe(true);
    expect(stopped()).toBe(1);
    expect(room.reports.length).toBeGreaterThan(0);
  });

  it("comes at the session's own limit when fewer minutes are left today", async () => {
    const { timers } = start({
      meta: {
        limits: { minutesRemainingToday: 4, paiseRemainingToday: 900, maxSessionMinutes: 4 },
      },
    });
    await settle();
    expect(timers.pending()).toEqual([4 * 60_000]);
  });

  it('comes when the BOS stops the session, and when the person leaves', async () => {
    const first = start({});
    await settle();
    await first.session.end('ended');
    await first.done;
    expect(first.room.sent.at(-1)).toEqual({ type: 'ended', reason: 'ended' });
    const second = start({});
    await settle();
    second.room.personLeaves();
    await second.done;
    expect(second.room.left).toBe(true);
  });

  it('comes when the person has not joined within a minute, before a word is said or heard', async () => {
    const stt = fakeStt();
    const { tts, spoken } = fakeTts(manualClock());
    const { room, timers, session, done, stopped } = start({
      personPresent: false,
      stt: stt.stt,
      tts,
    });
    await settle();
    expect(PERSON_JOIN_WAIT_MS).toBe(60_000);
    expect(timers.pending()).toContain(PERSON_JOIN_WAIT_MS);
    expect(spoken).toEqual([]);
    expect(stt.streams).toHaveLength(0);
    timers.fireAt(PERSON_JOIN_WAIT_MS);
    await done;
    expect(session.endReason).toBe('ended');
    expect(room.left).toBe(true);
    expect(stopped()).toBe(1);
    expect(room.reports.length).toBeGreaterThan(0);
    expect(timers.pending()).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it('starts once the person joins within the minute', async () => {
    const { tts, spoken } = fakeTts(manualClock());
    const { room, timers } = start({ personPresent: false, tts });
    await settle();
    room.personJoins();
    await settle();
    expect(timers.pending()).not.toContain(PERSON_JOIN_WAIT_MS);
    expect(spoken).toEqual([said('voice_greeting_ask')]);
    expect(room.left).toBe(false);
  });

  it('runs through when the room has closed under it (deleted by a later start)', async () => {
    const recorder = new WavRecorder();
    const { room, session, done, uploads, stopped } = start({
      meta: { mode: 'teach', consentRecording: true },
      recorder,
    });
    await settle();
    room.speak(new Int16Array(160).fill(100));
    await settle();
    const closed = () => Promise.reject(new Error('the room is closed'));
    room.send = closed;
    room.report = closed;
    room.leave = closed;
    // The room closing reaches the session as the person leaving.
    room.personLeaves();
    await done;
    expect(session.endReason).toBe('ended');
    expect(uploads).toHaveLength(1);
    expect(stopped()).toBe(1);
  });

  it("files a recorded Teach session's audio and reports its file", async () => {
    const recorder = new WavRecorder();
    const { room, session, done, uploads } = start({
      meta: { mode: 'teach', consentRecording: true },
      recorder,
    });
    await settle();
    room.speak(new Int16Array(1_600).fill(100));
    await settle();
    await session.end('ended');
    await done;
    expect(uploads).toHaveLength(1);
    // 1,600 samples at 16 kHz kept at 8 kHz: 800 samples after the 44-byte header.
    expect(uploads[0]?.length).toBe(44 + 1_600);
    expect(room.reports.at(-1)?.audioFileId).toBeDefined();
  });
});

describe('Teach drafts', () => {
  it('go to the page for the person to save, and Shakti says so', async () => {
    const draft = {
      id: newId(),
      type: 'faq' as const,
      audience: 'customer' as const,
      title: 'Subsidy kab milti hai',
      text: 'Subsidy installation ke baad discom inspection hone par milti hai.',
    };
    const responder: Responder = {
      respond: () => Promise.resolve({}),
      makeDrafts: () => Promise.resolve({ drafts: [draft] }),
    };
    const { room } = start({ responder, meta: { mode: 'teach' } });
    await settle();
    room.page({ type: 'make_drafts' });
    await settle();
    expect(room.sent).toContainEqual({ type: 'draft', draft });
    expect(room.sent).toContainEqual({
      type: 'caption',
      speaker: 'shakti',
      text: said('voice_drafts_ready'),
      final: true,
    });
  });
});
