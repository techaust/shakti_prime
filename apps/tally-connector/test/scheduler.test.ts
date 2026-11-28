import { describe, expect, it } from 'vitest';
import { createMemoryLog } from '../src/log';
import { Scheduler, type Timers } from '../src/scheduler';
import type { Syncer } from '../src/sync';

/**
 * A clock that moves only when the test moves it, so the scheduler's timing is exact on any
 * machine (a loaded Windows runner included). Between two timers it lets every waiting promise run.
 */
class TestTimers implements Timers {
  private at = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { due: number; run: () => void; every?: number }>();

  now = (): number => this.at;

  setTimeout = (run: () => void, ms: number): number => this.add(run, ms);
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };
  setInterval = (run: () => void, ms: number): number => this.add(run, ms, ms);
  clearInterval = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  /** Timers still set. */
  get count(): number {
    return this.timers.size;
  }

  private add(run: () => void, ms: number, every?: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { due: this.at + Math.max(0, ms), run, ...(every ? { every } : {}) });
    return id;
  }

  /** Moves the clock on by `ms`, running each timer due on the way at its own time. */
  async advance(ms: number): Promise<void> {
    const end = this.at + ms;
    for (;;) {
      await settle();
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= end)
        .sort(([a, x], [b, y]) => x.due - y.due || a - b)[0];
      if (due === undefined) break;
      const [id, timer] = due;
      this.at = timer.due;
      if (timer.every === undefined) this.timers.delete(id);
      else timer.due += timer.every;
      timer.run();
    }
    this.at = end;
    await settle();
  }
}

/** Lets every promise already resolved run its callbacks. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A syncer whose cycles take `cycleMs` on the test's clock, recording when each ran. */
function fakeSyncer(timers: TestTimers, cycleMs: number) {
  const events: { kind: 'beat' | 'cycle-start' | 'cycle-end'; at: number }[] = [];
  let stopRequested = false;
  const syncer = {
    heartbeat: () => {
      events.push({ kind: 'beat', at: timers.now() });
      return Promise.resolve(true);
    },
    cycle: async () => {
      events.push({ kind: 'cycle-start', at: timers.now() });
      await new Promise((resolve) => {
        timers.setTimeout(() => {
          resolve(undefined);
        }, cycleMs);
      });
      events.push({ kind: 'cycle-end', at: timers.now() });
      return 'caught_up' as const;
    },
    requestStop: () => {
      stopRequested = true;
    },
  };
  const at = (kind: (typeof events)[number]['kind']) =>
    events.filter((e) => e.kind === kind).map((e) => e.at);
  return { syncer: syncer as unknown as Syncer, at, stopped: () => stopRequested };
}

describe('the scheduler', () => {
  it('beats on its own timer through a long cycle, and never runs two cycles at once', async () => {
    const timers = new TestTimers();
    const fake = fakeSyncer(timers, 120);
    const scheduler = new Scheduler(
      fake.syncer,
      { heartbeatEveryMs: 30, readEveryMs: 50 },
      createMemoryLog(),
      timers,
    );
    scheduler.start();
    await timers.advance(400);
    const stopping = scheduler.stop();
    // The cycle in hand finishes before the scheduler stops.
    await timers.advance(100);
    await stopping;

    // Beats every 30 ms from the start, four of them before the first cycle ends at 120 ms.
    expect(fake.at('beat').filter((at) => at < 120)).toEqual([0, 30, 60, 90]);
    // A cycle that ran past the read interval is followed at once, never overlapped.
    expect(fake.at('cycle-start')).toEqual([0, 120, 240, 360]);
    expect(fake.at('cycle-end')).toEqual([120, 240, 360, 480]);
    expect(fake.stopped()).toBe(true);
    expect(timers.count).toBe(0);
  });

  it('waits the read interval between quick cycles, and stops at once while waiting', async () => {
    const timers = new TestTimers();
    const fake = fakeSyncer(timers, 1);
    const scheduler = new Scheduler(
      fake.syncer,
      { heartbeatEveryMs: 10_000, readEveryMs: 150 },
      createMemoryLog(),
      timers,
    );
    scheduler.start();
    await timers.advance(380);
    expect(fake.at('cycle-start')).toEqual([0, 150, 300]);

    // Stopping during the wait needs no time to pass, and leaves no timer behind.
    await scheduler.stop();
    expect(timers.now()).toBe(380);
    expect(timers.count).toBe(0);
    expect(fake.at('cycle-start')).toHaveLength(3);
  });
});
