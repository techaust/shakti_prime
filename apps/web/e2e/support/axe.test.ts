import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STILL_WAIT, violationsMessage, waitUntilStill } from './axe';

// The wait before axe runs (STATUS: `channels.spec.ts` measured a notice still fading in), on a
// stand-in page: its animations are what the case says, and frames come every 16 ms of fake time.

interface StandIn {
  playState: AnimationPlayState;
  pending: boolean;
  endTime: number;
}

let animations: StandIn[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  animations = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('document', {
    getAnimations: () =>
      animations.map((a) => ({
        playState: a.playState,
        pending: a.pending,
        effect: { getComputedTiming: () => ({ endTime: a.endTime }) },
      })),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs the wait on fake time; answers what it resolved with and after how many milliseconds. */
async function waited(): Promise<{ result: string; ms: number }> {
  const start = performance.now();
  let result: string | undefined;
  const wait = waitUntilStill(STILL_WAIT).then((r) => {
    result = r;
  });
  while (result === undefined) await vi.advanceTimersByTimeAsync(16);
  await wait;
  return { result, ms: performance.now() - start };
}

const fade = (): StandIn => ({ playState: 'running', pending: false, endTime: 400 });

describe('waitUntilStill', () => {
  it('answers after a few frames on a still page', async () => {
    expect(await waited()).toEqual({ result: 'still', ms: 3 * 16 });
  });

  it('waits for a fade that starts a frame after the first look, until it ends', async () => {
    setTimeout(() => {
      animations = [fade()];
    }, 20);
    setTimeout(() => {
      animations = [{ ...fade(), playState: 'finished' }];
    }, 420);
    const { result, ms } = await waited();
    expect(result).toBe('still');
    expect(ms).toBeGreaterThan(420);
    expect(ms).toBeLessThan(420 + 5 * 16);
  });

  it('counts a transition still to start (pending) as moving', async () => {
    animations = [{ playState: 'paused', pending: true, endTime: 300 }];
    setTimeout(() => {
      animations = [];
    }, 100);
    expect((await waited()).ms).toBeGreaterThan(100);
  });

  it('leaves a spinner, a paused animation and a finished one that holds its last frame', async () => {
    animations = [
      { playState: 'running', pending: false, endTime: Infinity },
      { playState: 'paused', pending: false, endTime: 300 },
      { playState: 'finished', pending: false, endTime: 300 },
    ];
    expect(await waited()).toEqual({ result: 'still', ms: 3 * 16 });
  });

  it('gives up after its limit on a page that never stops moving, so a journey cannot hang', async () => {
    animations = [fade()];
    const { result, ms } = await waited();
    expect(result).toBe('moving');
    expect(ms).toBeGreaterThanOrEqual(STILL_WAIT.limitMs);
    expect(ms).toBeLessThan(STILL_WAIT.limitMs + 4 * 16);
  });

  it('moves on where the page draws no frames', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    // Three 50 ms waits, seen in the 16 ms steps the case advances time by.
    const { result, ms } = await waited();
    expect(result).toBe('still');
    expect(ms).toBeGreaterThanOrEqual(3 * 50);
    expect(ms).toBeLessThan(3 * 50 + 16);
  });
});

describe('violationsMessage', () => {
  it('names a page that was still moving, so a contrast failure says it may be mid-fade', () => {
    expect(violationsMessage('still')).toBe('accessibility violations (WCAG 2.1 A and AA)');
    expect(violationsMessage('moving')).toBe(
      'accessibility violations (WCAG 2.1 A and AA); the page was still moving after 2000 ms, so a colour may have been measured mid-fade',
    );
  });
});
