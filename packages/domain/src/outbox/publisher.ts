import { DeliveredEvent, isDelivered, type OutboxPublishResponse } from '@shakti/contracts';
import type { ClaimOutbox, OutboxRow, OutboxUpdate } from '@shakti/db';
import type { EventPublisher, PublishResult } from '../ports/event-publisher';
import type { Logger } from '../ports/logger';
import { outboxRetryDelaySeconds } from './backoff';

/**
 * After this many attempts an event is dead-lettered and waits for a replay. With the backoff
 * (./backoff.ts) the last attempt comes about four hours after the first. The claim counts each
 * lease as an attempt, so a run that dies before it records an outcome uses one up too, and an
 * event whose runs keep dying is dead-lettered by the claim once they are spent.
 */
export const OUTBOX_MAX_ATTEMPTS = 10;
/** Rows one run claims; one batch call to the queue carries them all. */
export const OUTBOX_BATCH_SIZE = 100;

const ERROR_MAX_LENGTH = 200;

export interface OutboxPublisherOptions {
  claim: ClaimOutbox;
  publisher: EventPublisher;
  limit?: number;
  /** The jitter's source for the backoff; tests pass a fixed one. */
  random?: () => number;
  /**
   * Claim again while the last claim was full and this many milliseconds have not passed since
   * the run started, so a backlog drains within one call instead of one batch a minute. Left
   * out, the run claims once.
   */
  budgetMs?: number;
  /** The clock the budget is read from; tests pass their own. */
  now?: () => number;
  /** Where the run notes the events the claim dead-lettered because their runs kept dying. */
  logger?: Logger;
  /** The request id of the call that started the run, for its log lines. */
  requestId?: string | undefined;
  /**
   * Told the ids of every event the run dead-lettered: those the claim found with their attempts
   * spent as soon as the lease commits, so they are told even when the delivery or the recording
   * fails afterwards, and those whose last attempt failed here once the run has recorded them. The
   * web app reports them to Sentry (ids and counts only).
   */
  onDeadLettered?: (ids: readonly string[]) => void;
}

/** Ids one warning line names at most; the count gives the rest. */
export const DEAD_LETTER_LOG_IDS = 20;

/**
 * One publisher run (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.2): claim the due events in delivery
 * order (the claim leases them to this run and commits before anything is sent), send the ones a
 * worker listens to in one batch, and hand back the outcome of each for the claim to record. A
 * failed event is due again after its backoff; an event nobody listens to yet is marked delivered
 * without being sent; a row that no longer fits the catalogue can never be delivered, so it is
 * dead-lettered at once. The events the claim itself dead-lettered, whose attempts were all spent
 * by runs that died (`no_outcome`), count among the run's dead letters and are logged as one
 * warning with the run's request id, their count and at most `DEAD_LETTER_LOG_IDS` of their ids.
 *
 * With `budgetMs`, a run whose claim came back full claims again while the budget lasts, unless
 * every event of that claim failed, so a backlog drains in one call. An event whose payload says no
 * worker acts on it (the catalogue's `undeliveredWhen`) is marked delivered like one of a type
 * nobody listens to. Each event Send again put back goes out under its generation's deduplication
 * id; the first try of such a generation answered `deduplicated` delivered nothing, so it is
 * dead-lettered as `queue_deduplicated` rather than marked delivered.
 */
export async function runOutboxPublisher(
  options: OutboxPublisherOptions,
): Promise<OutboxPublishResponse> {
  const counts: OutboxPublishResponse = {
    claimed: 0,
    published: 0,
    skipped: 0,
    failed: 0,
    deadLettered: 0,
  };
  const failedDead: string[] = [];
  const deliver = async (rows: readonly OutboxRow[]): Promise<OutboxUpdate[]> => {
    const updates: OutboxUpdate[] = [];
    const toSend: DeliveredEvent[] = [];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const fail = (row: OutboxRow, error: string, now = false) => {
      // The attempts before this run and this one, which the claim has already counted in the
      // table: recording the same number counts it once.
      const attempts = row.attempts + 1;
      const deadLetter = now || attempts >= OUTBOX_MAX_ATTEMPTS;
      const lastError = error.slice(0, ERROR_MAX_LENGTH);
      updates.push(
        deadLetter
          ? { id: row.id, outcome: 'failed', attempts, lastError, deadLetter }
          : {
              id: row.id,
              outcome: 'failed',
              attempts,
              lastError,
              deadLetter,
              retryInSeconds: outboxRetryDelaySeconds(attempts, options.random),
            },
      );
      counts.failed += 1;
      if (deadLetter) {
        counts.deadLettered += 1;
        failedDead.push(row.id);
      }
    };

    for (const row of rows) {
      const event = DeliveredEvent.safeParse({
        id: row.id,
        sequence: row.sequence,
        type: row.type,
        entityId: row.entityId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload,
      });
      if (!event.success) {
        fail(row, 'not_in_catalogue', true);
      } else if (!isDelivered(row.type, event.data.payload)) {
        updates.push({ id: row.id, outcome: 'published' });
        counts.skipped += 1;
      } else {
        toSend.push(event.data);
      }
    }

    if (toSend.length > 0) {
      let results: readonly PublishResult[];
      try {
        const generations = new Map(
          toSend.flatMap((e) => {
            const replays = byId.get(e.id)?.replays ?? 0;
            return replays > 0 ? [[e.id, replays] as const] : [];
          }),
        );
        results = await options.publisher.publish(toSend, generations);
      } catch (e) {
        const code = e instanceof Error && e.name !== 'Error' ? e.name : 'publish_failed';
        results = toSend.map((event) => ({ id: event.id, ok: false, error: code }));
      }
      const answered = new Map(results.map((r) => [r.id, r]));
      for (const event of toSend) {
        const row = byId.get(event.id);
        if (row === undefined) continue;
        const result = answered.get(event.id);
        if (result?.ok === true && result.deduplicated === true && sentAgain(row)) {
          // The first try of a replayed generation can only be deduplicated if the queue took
          // its id before, so it delivered nothing now: held back rather than marked delivered.
          fail(row, 'queue_deduplicated', true);
        } else if (result?.ok === true) {
          updates.push({ id: row.id, outcome: 'published' });
          counts.published += 1;
        } else {
          fail(row, result === undefined ? 'no_answer' : result.error);
        }
      }
    }
    return updates;
  };
  // Logged as soon as the lease commits, before the delivery, which may throw.
  const spent = (ids: readonly string[]) => {
    counts.deadLettered += ids.length;
    if (ids.length > 0) options.onDeadLettered?.(ids);
    const truncated = ids.length > DEAD_LETTER_LOG_IDS;
    options.logger?.log('warn', 'outbox.no_outcome_dead_lettered', {
      requestId: options.requestId,
      count: ids.length,
      ids: ids.slice(0, DEAD_LETTER_LOG_IDS),
      ...(truncated ? { truncated: true } : {}),
    });
  };
  const limit = options.limit ?? OUTBOX_BATCH_SIZE;
  const clock = options.now ?? Date.now;
  const started = clock();
  for (;;) {
    const failedBefore = counts.failed;
    const claim = await options.claim(limit, deliver, OUTBOX_MAX_ATTEMPTS, spent);
    counts.claimed += claim.claimed;
    // A claim whose every event failed means the queue is down: the rest waits for the backoff.
    const more =
      claim.claimed === limit &&
      counts.failed - failedBefore < claim.claimed &&
      options.budgetMs !== undefined &&
      clock() - started < options.budgetMs;
    if (!more) break;
  }
  if (failedDead.length > 0) options.onDeadLettered?.(failedDead);
  return counts;
}

/**
 * A row in the first try of a generation Send again started: its replay counter is up and no
 * attempt of this generation came before (the claim answers the attempts before this one). A
 * later try may be deduplicated because an earlier one of the same generation reached the queue
 * before its run died, which is a delivery.
 */
function sentAgain(row: OutboxRow): boolean {
  return row.replays > 0 && row.attempts === 0;
}
