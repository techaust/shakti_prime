import { errorKind, type Log } from './log';
import type { Settings } from './settings';
import type { Syncer } from './sync';

/**
 * The connector's clock (docs/03-roadmap-appendix/phase5.md §6.2): a heartbeat every
 * `heartbeatEveryMs` on its own timer, so a long catch-up never silences it, and a sync cycle every
 * `readEveryMs` (each company read while the BOS answers, the daily snapshot after 02:00 India
 * time). Cycles never overlap: the next one starts `readEveryMs` after the last one began, or at
 * once when that one ran longer.
 */

export type SchedulerSettings = Pick<Settings, 'heartbeatEveryMs' | 'readEveryMs'>;

/** The clock and timers the scheduler runs on: the system's, or a test's own. */
export interface Timers {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(run: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const SYSTEM_TIMERS: Timers = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setInterval: (run, ms) => setInterval(run, ms),
  clearInterval: (handle) => {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export class Scheduler {
  private running = false;
  private loop: Promise<void> | undefined;
  private beatTimer: unknown;
  private beating = false;
  private wake: (() => void) | undefined;

  constructor(
    private readonly syncer: Syncer,
    private readonly settings: SchedulerSettings,
    private readonly log: Log,
    private readonly timers: Timers = SYSTEM_TIMERS,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log.info('connector_started');
    void this.beat();
    this.beatTimer = this.timers.setInterval(
      () => void this.beat(),
      this.settings.heartbeatEveryMs,
    );
    this.loop = this.run();
  }

  private async beat(): Promise<void> {
    if (this.beating) return;
    this.beating = true;
    try {
      await this.syncer.heartbeat();
    } finally {
      this.beating = false;
    }
  }

  private async run(): Promise<void> {
    while (this.running) {
      const startedAt = this.timers.now();
      try {
        await this.syncer.cycle();
      } catch (error) {
        this.log.error('cycle_failed', { kind: errorKind(error) });
      }
      if (this.stopped()) break;
      await this.pause(this.settings.readEveryMs - (this.timers.now() - startedAt));
    }
  }

  /** Waits, unless `stop()` wakes it first. */
  private pause(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.timers.clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      const timer = this.timers.setTimeout(done, ms);
      this.wake = done;
    });
  }

  /** Read through a method: `stop()` changes it while a cycle is awaited. */
  private stopped(): boolean {
    return !this.running;
  }

  /** Stops after the page in hand; the outbox keeps whatever was not answered. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.beatTimer !== undefined) this.timers.clearInterval(this.beatTimer);
    this.syncer.requestStop();
    this.wake?.();
    await this.loop;
    this.log.info('connector_stopped');
  }
}
