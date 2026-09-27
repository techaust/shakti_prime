import type { DeliveredEvent } from '@shakti/contracts';
import type { EventPublisher, PublishResult } from '@shakti/domain';
import { Client, Receiver } from '@upstash/qstash';

/** Where QStash calls the publisher; the schedule and every nudge target it. */
export const OUTBOX_PUBLISH_PATH = '/api/v1/workers/outbox/publish';

/** A queue call that takes longer than this counts as failed; the next run tries again. */
const QUEUE_TIMEOUT_MS = 5_000;
const NUDGE_TIMEOUT_MS = 1_000;

export interface QStashConfig {
  token: string;
  currentSigningKey: string;
  nextSigningKey: string;
  /** The regional QStash endpoint, when not the default. */
  baseUrl: string | undefined;
  /** The public address of the publisher route, which a signed call must name. */
  publishUrl: string;
}

/** QStash settings when every one of them is set, otherwise nothing (local development and CI). */
export function qstashConfig(env: NodeJS.ProcessEnv = process.env): QStashConfig | undefined {
  const token = env.QSTASH_TOKEN ?? '';
  const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY ?? '';
  const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY ?? '';
  const appUrl = env.BETTER_AUTH_URL ?? '';
  if (token === '' || currentSigningKey === '' || nextSigningKey === '' || appUrl === '') {
    return undefined;
  }
  let publishUrl: string;
  try {
    publishUrl = new URL(OUTBOX_PUBLISH_PATH, appUrl).toString();
  } catch {
    return undefined;
  }
  const baseUrl =
    env.QSTASH_URL === undefined || env.QSTASH_URL === '' ? undefined : env.QSTASH_URL;
  return { token, currentSigningKey, nextSigningKey, baseUrl, publishUrl };
}

function client(config: QStashConfig): Client {
  // No local dev server and no telemetry; one quick retry, since the outbox retries anyway.
  return new Client({
    token: config.token,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    retry: { retries: 1, backoff: () => 200 },
    enableTelemetry: false,
    devMode: false,
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`no answer within ${String(ms)} ms`), { name: 'TimeoutError' }),
      );
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/** The queue group that fans one event type out to its workers. */
export function urlGroupFor(type: string): string {
  return `evt-${type}`;
}

/** One answer of the batch call: an accepted message, or the queue's reason for refusing it. */
function resultOf(id: string, answer: unknown): PublishResult {
  // A queue group answers one entry per endpoint; every entry must carry a message id.
  const parts: unknown[] = Array.isArray(answer) ? answer : [answer];
  const accepted =
    parts.length > 0 &&
    parts.every((p) => typeof p === 'object' && p !== null && 'messageId' in p && !('error' in p));
  return accepted ? { id, ok: true } : { id, ok: false, error: 'queue_refused' };
}

/**
 * Sends a run's events in one batch call, each to its type's queue group, with the event id as
 * the deduplication id so a retried run never delivers an event twice within QStash's window.
 */
export function qstashEventPublisher(config: QStashConfig): EventPublisher {
  const qstash = client(config);
  return {
    async publish(events: readonly DeliveredEvent[]) {
      if (events.length === 0) return [];
      const answers: unknown[] = await withTimeout(
        qstash.batchJSON(
          events.map((event) => ({
            urlGroup: urlGroupFor(event.type),
            body: event,
            deduplicationId: event.id,
          })),
        ),
        QUEUE_TIMEOUT_MS,
      );
      return events.map((event, i) => resultOf(event.id, answers[i]));
    },
  };
}

/** Asks QStash to run the publisher now instead of at the next scheduled minute. */
export async function nudgeViaQStash(config: QStashConfig): Promise<void> {
  await withTimeout(
    client(config).publishJSON({ url: config.publishUrl, body: {}, retries: 1 }),
    NUDGE_TIMEOUT_MS,
  );
}

/**
 * True when the call carries a valid QStash signature, made with the current or the next signing
 * key, for this route and this exact body.
 */
export async function verifyQStashSignature(
  config: QStashConfig,
  signature: string | null,
  body: string,
): Promise<boolean> {
  if (signature === null || signature === '') return false;
  const receiver = new Receiver({
    currentSigningKey: config.currentSigningKey,
    nextSigningKey: config.nextSigningKey,
    devMode: false,
  });
  try {
    return await receiver.verify({ signature, body, url: config.publishUrl, clockTolerance: 5 });
  } catch {
    return false;
  }
}
