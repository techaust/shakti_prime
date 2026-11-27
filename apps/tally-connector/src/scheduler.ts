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

export class Scheduler {
  private running = false;
  private loop: Promise<void> | undefined;
  private beatTimer: ReturnType<typeof setInterval> | undefined;
  private beating = false;
  private wake: (() => void) | undefined;

  constructor(
    private readonly syncer: Syncer,
    private readonly settings: SchedulerSettings,
    private readonly log: Log,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log.info('connector_started');
    void this.beat();
    this.beatTimer = setInterval(() => void this.beat(), this.settings.heartbeatEveryMs);
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
      const startedAt = this.now();
      try {
        await this.syncer.cycle();
      } catch (error) {
        this.log.error('cycle_failed', { kind: errorKind(error) });
      }
      if (this.stopped()) break;
      await this.pause(this.settings.readEveryMs - (this.now() - startedAt));
    }
  }

  /** Waits, unless `stop()` wakes it first. */
  private pause(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
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
    if (this.beatTimer !== undefined) clearInterval(this.beatTimer);
    this.syncer.requestStop();
    this.wake?.();
    await this.loop;
    this.log.info('connector_stopped');
  }
}
