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

/** A notice on the stand-in page: its sonner attributes and its computed opacity. */
interface Notice {
  attributes: Record<string, string>;
  opacity: string;
}

let notices: Notice[] = [];
const shownNotice = (opacity: string): Notice => ({
  attributes: { 'data-mounted': 'true', 'data-visible': 'true', 'data-removed': 'false' },
  opacity,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  animations = [];
  notices = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('getComputedStyle', (notice: Notice) => ({ opacity: notice.opacity }));
  vi.stubGlobal('document', {
    querySelectorAll: (selector: string) => {
      expect(selector).toBe('[data-sonner-toast]');
      return notices.map((notice) => ({
        ...notice,
        getAttribute: (name: string) => notice.attributes[name] ?? null,
      }));
    },
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

  it('waits for a notice that sits in the page before its fade starts, until it is opaque', async () => {
    // No animation at any point: only the notice's own state shows it is not yet on show.
    notices = [{ ...shownNotice('0'), attributes: { 'data-mounted': 'false' } }];
    setTimeout(() => {
      notices = [shownNotice('0')];
    }, 100);
    setTimeout(() => {
      notices = [shownNotice('0.4')];
    }, 300);
    setTimeout(() => {
      notices = [shownNotice('1')];
    }, 500);
    const { result, ms } = await waited();
    expect(result).toBe('still');
    expect(ms).toBeGreaterThan(500);
    expect(ms).toBeLessThan(500 + 5 * 16);
  });

  it('does not wait for a notice that is leaving or hidden behind others', async () => {
    notices = [
      shownNotice('1'),
      {
        ...shownNotice('0'),
        attributes: { ...shownNotice('0').attributes, 'data-removed': 'true' },
      },
      {
        ...shownNotice('0'),
        attributes: { ...shownNotice('0').attributes, 'data-visible': 'false' },
      },
    ];
    expect(await waited()).toEqual({ result: 'still', ms: 3 * 16 });
  });

  it('gives up after its limit on a notice that never becomes opaque', async () => {
    notices = [shownNotice('0.5')];
    const { result, ms } = await waited();
    expect(result).toBe('moving');
    expect(ms).toBeLessThan(STILL_WAIT.limitMs + 4 * 16);
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
