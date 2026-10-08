/** The wait after an event's first failed attempt. */
export const OUTBOX_BACKOFF_BASE_SECONDS = 60;
/** No wait between attempts is longer than an hour. */
export const OUTBOX_BACKOFF_CAP_SECONDS = 3_600;
/** Each wait moves by up to a fifth either way, so events that failed together come back apart. */
export const OUTBOX_BACKOFF_JITTER = 0.2;

/**
 * Seconds before a failed event is tried again after its `attempts`-th failure: 1, 2, 4, 8, 16
 * and 32 minutes, then an hour for each later one (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.2). With
 * ten attempts the last one comes about four hours after the first (between three and a quarter
 * and four and a quarter hours with the jitter), so a queue outage of a few hours ends with every
 * event delivered and none dead-lettered. `random` answers in [0, 1); tests pass a fixed one.
 */
export function outboxRetryDelaySeconds(
  attempts: number,
  random: () => number = Math.random,
): number {
  const failures = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  const doublings = Math.min(failures - 1, 30);
  const base = Math.min(OUTBOX_BACKOFF_CAP_SECONDS, OUTBOX_BACKOFF_BASE_SECONDS * 2 ** doublings);
  const drawn = random();
  const r = Number.isFinite(drawn) ? Math.min(Math.max(drawn, 0), 1) : 0.5;
  const jittered = base * (1 - OUTBOX_BACKOFF_JITTER + 2 * OUTBOX_BACKOFF_JITTER * r);
  return Math.min(OUTBOX_BACKOFF_CAP_SECONDS, Math.round(jittered));
}
