import {
  newId,
  type VoiceDispatchMetadata,
  type VoiceRoomMessage,
  type VoiceTurnStats,
} from '@shakti/contracts';
import {
  AsyncQueue,
  type SpeechChunk,
  type StreamingSpeechToText,
  type StreamingTextToSpeech,
  type SttEvent,
} from '@shakti/voice';
import { setTimeout as sleep } from 'node:timers/promises';
import { fakeRoom } from './room';
import { VoiceSession, type Responder } from './session';

/**
 * Voice turn timing on V2's fake room (docs/03-roadmap-appendix/phase2.md §8.1 and §9.3), the part
 * that needs no vendor: the worker's own session runs on the real clock and timers, with stand-ins
 * for the speech services and the reply that answer after the delays given, and its
 * `turnStats()` (what `voice_sessions.turn_stats_json` keeps) is read after the turns.
 * - With every delay 0 the steps are the worker's own time between the vendors' events: what it
 *   adds to the budget.
 * - With §9.3's budget as the delays (final transcript 250 ms, the model's first sentence 600 ms,
 *   its first audio 250 ms) the steps must come out at the budget plus that small overhead, which
 *   checks the timing itself.
 * The real p50 and p95 need the vendors and the LiveKit project (V1 part 2's keys).
 */

export interface StandInDelays {
  /** From the end of speech to the final transcript. */
  finalMs: number;
  /** From the final transcript to the reply's first sentence. */
  firstSentenceMs: number;
  /** From a sentence to its first audio. */
  firstAudioMs: number;
}

/** §9.3's p50 budget for the three vendor steps; the network and playback's 150 ms are not here. */
export const BUDGET_DELAYS: StandInDelays = {
  finalMs: 250,
  firstSentenceMs: 600,
  firstAudioMs: 250,
};
export const NO_DELAYS: StandInDelays = { finalMs: 0, firstSentenceMs: 0, firstAudioMs: 0 };

const WAIT_STEP_MS = 2;
const WAIT_LIMIT_MS = 30_000;

async function until(done: () => boolean): Promise<void> {
  const deadline = performance.now() + WAIT_LIMIT_MS;
  while (!done()) {
    if (performance.now() > deadline) throw new Error('the session did not reach the step in time');
    await sleep(WAIT_STEP_MS);
  }
}

function metadata(now: number): VoiceDispatchMetadata {
  return {
    sessionId: newId(),
    apiBase: 'https://bos.measure.invalid/api/v1',
    bosToken: { token: 'a.b.c', expiresAt: new Date(now + 15 * 60_000).toISOString() },
    mode: 'ask',
    consentRecording: false,
    notAfter: new Date(now + 15 * 60_000).toISOString(),
    // Limits no measuring run reaches; the stand-ins report no tokens.
    limits: { minutesRemainingToday: 30, paiseRemainingToday: 1_000_000, maxSessionMinutes: 15 },
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
  };
}

/** Runs `turns` spoken turns through a session on the fake room; answers its turn stats. */
export async function measureTurnTiming(options: {
  turns: number;
  delays: StandInDelays;
}): Promise<VoiceTurnStats> {
  const { delays } = options;
  const clock = { now: () => performance.now() };
  let events: AsyncQueue<SttEvent> | undefined;
  const stt: StreamingSpeechToText = {
    vendor: 'stand-in',
    open: () => {
      const queue = new AsyncQueue<SttEvent>();
      events = queue;
      return Promise.resolve({
        send: () => undefined,
        end: () => undefined,
        close: () => {
          queue.close();
        },
        events: queue,
      });
    },
  };
  const tts: StreamingTextToSpeech = {
    vendor: 'stand-in',
    open: () =>
      Promise.resolve({
        async *speak(): AsyncIterable<SpeechChunk> {
          if (delays.firstAudioMs > 0) await sleep(delays.firstAudioMs);
          yield { audio: new Uint8Array(4), mimeType: 'audio/L16;rate=22050', atMs: clock.now() };
        },
        close: () => undefined,
      }),
  };
  const responder: Responder = {
    async respond(_text, turn) {
      if (delays.firstSentenceMs > 0) await sleep(delays.firstSentenceMs);
      turn.onSentence('Ji, 5 HP pump stock mein hai.');
      return {};
    },
  };
  const room = fakeRoom();
  const session = new VoiceSession({
    room,
    metadata: metadata(Date.now()),
    bos: {
      stop: () => undefined,
      uploadRecording: () => Promise.resolve({ fileId: newId(), linked: true }),
    },
    responder,
    stt,
    tts,
    clock,
    wallNow: () => Date.now(),
    timers: {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (timer) => {
        clearTimeout(timer as NodeJS.Timeout);
      },
    },
    languageCode: 'hi-IN',
  });
  const done = session.run();
  // The light as the page last saw it (other messages, the minutes left, come between).
  const listening = () =>
    room.sent.findLast((m): m is Extract<VoiceRoomMessage, { type: 'state' }> => m.type === 'state')
      ?.state === 'listening';
  // The greeting is spoken first; a turn begins once the light is back on listening.
  await until(() => events !== undefined && room.played.length > 0 && listening());
  for (let turn = 0; turn < options.turns; turn += 1) {
    const queue = events;
    if (queue === undefined) throw new Error('the speech stream is not open');
    queue.push({ type: 'speech_start', atMs: clock.now() });
    queue.push({ type: 'speech_end', atMs: clock.now() });
    if (delays.finalMs > 0) await sleep(delays.finalMs);
    queue.push({ type: 'final', text: 'pump hai?', languageCode: 'hi-IN', atMs: clock.now() });
    // Each completed turn sends its report; the next waits for the light.
    await until(() => room.reports.length > turn && listening());
  }
  const stats = session.turnStats();
  room.personLeaves();
  await done;
  return stats;
}
