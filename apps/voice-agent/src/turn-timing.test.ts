import { describe, expect, it } from 'vitest';
import { measureTurnTiming } from './turn-timing';

// The G2 voice measure (turn-timing.ts) on the fake room with the real clock: every turn is
// counted, and each step is at least the stand-in's delay for it, the first audio at least their
// sum. Upper bounds are left to the measure itself: a busy test machine may add any delay.

describe('voice turn timing on the fake room', () => {
  it('counts every turn and times each step from its own events', async () => {
    const { turnStats: stats, toPlayback } = await measureTurnTiming({
      turns: 3,
      delays: { finalMs: 20, firstSentenceMs: 40, firstAudioMs: 30 },
    });
    expect(stats.turns).toBe(3);
    expect(stats.steps.final_transcript?.p50Ms).toBeGreaterThanOrEqual(19);
    expect(stats.steps.first_sentence?.p50Ms).toBeGreaterThanOrEqual(39);
    expect(stats.steps.first_speech?.p50Ms).toBeGreaterThanOrEqual(29);
    expect(stats.steps.first_audio?.p50Ms).toBeGreaterThanOrEqual(88);
    const parts =
      (stats.steps.final_transcript?.p50Ms ?? 0) +
      (stats.steps.first_sentence?.p50Ms ?? 0) +
      (stats.steps.first_speech?.p50Ms ?? 0);
    // The first audio is the three steps end to end, never less than them.
    expect(stats.steps.first_audio?.p50Ms).toBeGreaterThanOrEqual(parts - 3);
    // Timed from outside the session, to the room's play: every turn, at least the delays' sum.
    expect(toPlayback.n).toBe(3);
    expect(toPlayback.min).toBeGreaterThanOrEqual(88);
  });
});
