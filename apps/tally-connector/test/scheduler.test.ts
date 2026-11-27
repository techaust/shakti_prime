import { describe, expect, it } from 'vitest';
import { createMemoryLog } from '../src/log';
import { Scheduler } from '../src/scheduler';
import type { Syncer } from '../src/sync';

/** A syncer whose cycles take `cycleMs`, recording when each ran. */
function fakeSyncer(cycleMs: number) {
  const events: { kind: 'beat' | 'cycle-start' | 'cycle-end'; at: number }[] = [];
  let stopRequested = false;
  const syncer = {
    heartbeat: () => {
      events.push({ kind: 'beat', at: Date.now() });
      return Promise.resolve(true);
    },
    cycle: async () => {
      events.push({ kind: 'cycle-start', at: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, cycleMs));
      events.push({ kind: 'cycle-end', at: Date.now() });
      return 'caught_up' as const;
    },
    requestStop: () => {
      stopRequested = true;
    },
  };
  return { syncer: syncer as unknown as Syncer, events, stopped: () => stopRequested };
}

describe('the scheduler', () => {
  it('beats on its own timer through a long cycle, and never runs two cycles at once', async () => {
    const fake = fakeSyncer(120);
    const scheduler = new Scheduler(
      fake.syncer,
      { heartbeatEveryMs: 30, readEveryMs: 50 },
      createMemoryLog(),
    );
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await scheduler.stop();

    const beats = fake.events.filter((e) => e.kind === 'beat');
    const firstCycleEnd = fake.events.find((e) => e.kind === 'cycle-end')?.at ?? 0;
    expect(beats.filter((b) => b.at < firstCycleEnd).length).toBeGreaterThanOrEqual(3);
    let running = 0;
    for (const event of fake.events) {
      if (event.kind === 'cycle-start') running += 1;
      if (event.kind === 'cycle-end') running -= 1;
      expect(running).toBeLessThanOrEqual(1);
    }
    expect(fake.events.filter((e) => e.kind === 'cycle-start').length).toBeGreaterThanOrEqual(2);
    expect(fake.stopped()).toBe(true);
  });

  it('waits the read interval between quick cycles, and stops at once while waiting', async () => {
    const fake = fakeSyncer(1);
    const scheduler = new Scheduler(
      fake.syncer,
      { heartbeatEveryMs: 10_000, readEveryMs: 150 },
      createMemoryLog(),
    );
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 380));
    const started = Date.now();
    await scheduler.stop();
    expect(Date.now() - started).toBeLessThan(50);
    const starts = fake.events.filter((e) => e.kind === 'cycle-start').map((e) => e.at);
    expect(starts).toHaveLength(3);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(140);
  });
});
