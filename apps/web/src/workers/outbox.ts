import {
  DomainError,
  PublisherRun,
  type DeliveredEvent,
  type OutboxPublishResponse,
} from '@shakti/contracts';
import {
  runOutboxPublisher,
  type EventPublisher,
  type KeyValue,
  type PublishResult,
} from '@shakti/domain';
import { checkOutboxReady as checkOutboxLag, claimOutbox } from '@shakti/db/outbox';
import { defaultAuthDeps, hostedRuntime } from '../auth/deps';
import { logger } from '../log';
import { sentryAlertSink, type AlertSink } from '../observability/alerts';
import { deliverEvent } from './events/deliver';
import { nudgeViaQStash, qstashConfig, qstashEventPublisher } from './qstash';

/** A due event waiting longer than this means no publisher is running. */
const OUTBOX_MAX_DUE_SECONDS = 300;

/** Runs in a row that deliver nothing before the owner is told (docs/03-roadmap-appendix/phase1.md §5.2). */
export const FAILING_RUNS_ALERT = 3;
/** Ids an alert names at most; the count gives the rest. */
export const ALERT_IDS = 20;

const LAST_RUN_KEY = 'outbox:last_run';
const FAILING_RUNS_KEY = 'outbox:failing_runs';
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Readiness of the outbox: down only when a due event has waited more than five minutes since it
 * became due, which means the publisher is not running. Events waiting out their backoff and dead
 * letters are logged with their counts instead; a queue outage alone never marks the app unready.
 */
export function checkOutboxReady(): Promise<'ok' | 'down'> {
  return checkOutboxLag(OUTBOX_MAX_DUE_SECONDS, 3_000, (lag) => {
    if (lag.retrying === 0 && lag.deadLettered === 0) return;
    logger.log(lag.deadLettered > 0 ? 'warn' : 'info', 'outbox.backlog', {
      retrying: lag.retrying,
      deadLettered: lag.deadLettered,
      inFlight: lag.inFlight,
      oldestPendingSeconds: lag.oldestPendingSeconds,
    });
  });
}

/**
 * Used where no queue is configured (local development and CI): each subscribed event goes to its
 * worker in this process, through the same checks and handler as the worker route
 * (`deliverEvent`). A worker's failure is the event's failure, retried after its backoff and
 * dead-lettered after its last attempt, as a refusal by the queue would be.
 */
export function inProcessEventPublisher(keyValue: KeyValue, requestId?: string): EventPublisher {
  return {
    async publish(events: readonly DeliveredEvent[]) {
      const results: PublishResult[] = [];
      for (const event of events) {
        try {
          await deliverEvent(event, { keyValue, requestId: requestId ?? event.id });
          results.push({ id: event.id, ok: true });
        } catch (error) {
          const code = error instanceof DomainError ? error.code : 'internal';
          logger.log('warn', 'outbox.worker_failed', {
            requestId,
            eventId: event.id,
            type: event.type,
            errorCode: code,
            error,
          });
          results.push({ id: event.id, ok: false, error: code });
        }
      }
      return results;
    },
  };
}

export interface PublishOutboxOptions {
  publisher?: EventPublisher;
  requestId?: string;
  /** Where the counters and the last run are kept; the app's shared store by default. */
  keyValue?: KeyValue;
  /** Where the outbox alerts go; Sentry by default. */
  alerts?: AlertSink;
  now?: () => Date;
}

/**
 * One publisher run against QStash when configured, and its counts in the log; the events the
 * claim dead-lettered because their runs kept dying get a warning line of their own, by id.
 *
 * The run's counts are kept for Integration Health (`outbox:last_run`, a day). The owner is told
 * through Sentry, with counts and ids only, when a run dead-letters any event
 * (`outbox.dead_lettered`) and when a third run in a row fails to deliver anything it tried
 * (`outbox.publisher_failing`); a run that delivers resets that count, and a run with nothing to
 * send leaves it as it was.
 */
export async function publishOutbox(
  options: PublishOutboxOptions = {},
): Promise<OutboxPublishResponse> {
  const { requestId } = options;
  const keyValue = options.keyValue ?? defaultAuthDeps().keyValue;
  const alerts = options.alerts ?? sentryAlertSink;
  const now = options.now ?? (() => new Date());
  const publisher = options.publisher ?? defaultPublisher(keyValue, requestId);
  const deadIds: string[] = [];
  const reportDead = () => {
    if (deadIds.length === 0) return;
    alerts.report('outbox.dead_lettered', {
      count: deadIds.length,
      ids: deadIds.slice(0, ALERT_IDS),
    });
  };
  let counts: OutboxPublishResponse;
  try {
    counts = await runOutboxPublisher({
      claim: claimOutbox,
      publisher,
      logger,
      requestId,
      onDeadLettered: (ids) => {
        deadIds.push(...ids);
      },
    });
  } catch (error) {
    // The events the claim dead-lettered stay dead-lettered whatever failed afterwards.
    reportDead();
    await countFailingRun(keyValue, alerts, { requestId, failed: 0 });
    throw error;
  }
  if (counts.claimed > 0 || counts.deadLettered > 0) {
    logger.log('info', 'outbox.publish', { requestId, ...counts });
  }
  reportDead();
  await keep('outbox.last_run_not_kept', requestId, () =>
    keyValue.set(
      LAST_RUN_KEY,
      JSON.stringify(PublisherRun.parse({ at: now().toISOString(), ...counts })),
      DAY_SECONDS,
    ),
  );
  if (counts.published > 0) {
    await keep('outbox.failing_runs_not_kept', requestId, () => keyValue.del(FAILING_RUNS_KEY));
  } else if (counts.failed > 0) {
    await countFailingRun(keyValue, alerts, { requestId, failed: counts.failed });
  }
  return counts;
}

/** A store failure never fails the run: its outcomes are recorded in the database already. */
async function keep(
  event: string,
  requestId: string | undefined,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.log('warn', event, { requestId, error });
  }
}

async function countFailingRun(
  keyValue: KeyValue,
  alerts: AlertSink,
  run: { requestId: string | undefined; failed: number },
): Promise<void> {
  let runs = 0;
  await keep('outbox.failing_runs_not_kept', run.requestId, async () => {
    runs = await keyValue.incr(FAILING_RUNS_KEY, DAY_SECONDS);
  });
  // Once per streak: the count keeps rising until a run delivers, and only the third run reports.
  if (runs === FAILING_RUNS_ALERT) {
    alerts.report('outbox.publisher_failing', { runs, failed: run.failed });
  }
}

/** The last publisher run's counts, for Integration Health; undefined when none is kept. */
export async function lastPublisherRun(keyValue: KeyValue): Promise<PublisherRun | undefined> {
  const text = await keyValue.get(LAST_RUN_KEY);
  if (text === null) return undefined;
  try {
    const parsed = PublisherRun.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function defaultPublisher(keyValue: KeyValue, requestId: string | undefined): EventPublisher {
  const config = qstashConfig();
  return config === undefined
    ? inProcessEventPublisher(keyValue, requestId)
    : qstashEventPublisher(config);
}

/**
 * After a command commits with events (`executeCommand`'s `onCommitted`): hosted, QStash is
 * asked to run the publisher at once; locally, with no queue, the run happens in this process
 * and delivers subscribed events to their workers here. The minute schedule catches anything a
 * lost nudge leaves behind.
 */
export async function nudgeOutbox(): Promise<void> {
  const config = qstashConfig();
  if (config !== undefined) {
    await nudgeViaQStash(config);
    return;
  }
  if (!hostedRuntime()) await publishOutbox();
}
