import type { ErrorCode, WebhookAck, WebhookProvider } from '@shakti/contracts';
import { storeWebhookDelivery, webhookReceiverConfigured } from '@shakti/db/webhooks';
import type { KeyValue } from '@shakti/domain';
import { after } from 'next/server';
import { createHash } from 'node:crypto';
import { defaultAuthDeps } from '../auth/deps';
import { logger } from '../log';
import { readBytesWithin } from '../request-body';
import { incomingRequestId } from '../request-id';
import { publishWebhookJob, qstashConfig, type QStashConfig } from '../workers/qstash';
import { workerFailure } from '../workers/route-answers';
import { processWebhook } from '../workers/webhooks/process';
import { metaChallenge } from './checks';
import type { Delivery, WebhookVerifier } from './providers';
import { countRefusal } from './refusals';

/** What a webhook route reaches beyond the request; tests pass their own. */
export interface WebhookDeps {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  receiverConfigured: () => boolean;
  keyValue: () => KeyValue;
  store: typeof storeWebhookDelivery;
  qstash: () => QStashConfig | undefined;
  publish: (config: QStashConfig, inboxId: string, deduplicationId: string) => Promise<void>;
  /** Runs work after the answer has gone (`after()` in a request). */
  later: (task: () => Promise<unknown>) => void;
  process: typeof processWebhook;
}

function afterTheAnswer(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // Outside a request (a script, a test) there is no answer to wait for.
    void task();
  }
}

export function defaultWebhookDeps(): WebhookDeps {
  return {
    env: process.env,
    now: () => new Date(),
    receiverConfigured: webhookReceiverConfigured,
    keyValue: () => defaultAuthDeps().keyValue,
    store: storeWebhookDelivery,
    qstash: () => qstashConfig(),
    publish: publishWebhookJob,
    later: afterTheAnswer,
    process: processWebhook,
  };
}

/** The longest provider event id kept; a longer one is keyed on the body's SHA-256 instead. */
const EVENT_ID_MAX = 200;

/**
 * Postgres keeps no NUL character in JSON text; a provider string that carries one would make
 * every redelivery fail to store, so it is dropped.
 */
function withoutNul(value: unknown): unknown {
  if (typeof value === 'string')
    return value.includes('\u0000') ? value.replaceAll('\u0000', '') : value;
  if (Array.isArray(value)) return value.map(withoutNul);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [withoutNul(k), withoutNul(v)]),
    );
  }
  return value;
}

function headersFor(requestId: string): Record<string, string> {
  return { 'cache-control': 'no-store', 'x-request-id': requestId };
}

function refuse(code: ErrorCode, requestId: string): Response {
  return workerFailure(code, requestId, headersFor(requestId));
}

/** The route's path parameters, as Next.js hands them to a handler. */
export interface RouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

async function paramsOf(context: RouteContext | undefined): Promise<Record<string, string>> {
  if (context === undefined) return {};
  const params = await context.params;
  return Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

export interface ReceiveOptions {
  /** `query` for a provider that calls with GET and its fields in the address (Exotel Passthru). */
  source?: 'body' | 'query';
  deps?: Partial<WebhookDeps>;
}

/**
 * A provider webhook route (docs/06-api.md §3.4, docs/03-roadmap-appendix/phase2.md §5.1), in this
 * order:
 * 1. the provider's secrets and the receiver's connection, else `503 integration_unavailable`
 *    before the body is read (production until the final phase, question 13);
 * 2. the body read once, up to the provider's cap, else `400 validation_failed`;
 * 3. the provider's check, else `401 unauthorized`, counted per provider and hour in the
 *    key-value store, and nothing stored;
 * 4. the delivery stored once as `webhook_receiver` (`app.webhook_receive()`), keyed on the
 *    provider's event id or the body's SHA-256, else `503` so the provider delivers it again;
 * 5. a new row published to the worker with its id as the deduplication id (a failed publish is
 *    logged and the sweep publishes the row later), or, with no queue (locally and in CI),
 *    processed in this process after the answer; a repeat is answered and not published again;
 * 6. `200 { received: true }`.
 * Nothing of the payload is logged: provider, problem, row id and request id only.
 */
export function receiveWebhook<S>(
  provider: WebhookProvider,
  verify: WebhookVerifier<S>,
  options: ReceiveOptions = {},
): (request: Request, context?: RouteContext) => Promise<Response> {
  return async (request, context) => {
    const deps: WebhookDeps = { ...defaultWebhookDeps(), ...options.deps };
    const requestId = incomingRequestId(request.headers);
    const secrets = verify.secrets(deps.env);
    if (secrets === undefined || !deps.receiverConfigured()) {
      logger.log('info', 'webhooks.unavailable', { requestId, provider });
      return refuse('integration_unavailable', requestId);
    }

    const raw =
      options.source === 'query'
        ? new TextEncoder().encode(new URL(request.url).search.slice(1))
        : await readBytesWithin(request, verify.maxBytes);
    if (raw === undefined || raw.byteLength > verify.maxBytes) {
      logger.log('warn', 'webhooks.too_large', { requestId, provider });
      return refuse('validation_failed', requestId);
    }
    const delivery: Delivery = {
      raw,
      text: new TextDecoder().decode(raw),
      url: request.url,
      headers: request.headers,
      params: await paramsOf(context),
    };

    const now = deps.now();
    const check = await verify.check(delivery, secrets, now);
    if (!check.ok) {
      logger.log('warn', 'webhooks.refused', { requestId, provider, problem: check.problem });
      try {
        await countRefusal(deps.keyValue(), provider, now);
      } catch (error) {
        logger.log('warn', 'webhooks.refusal_not_counted', { requestId, provider, error });
      }
      return refuse('unauthorized', requestId);
    }

    const payload = withoutNul(verify.payload(delivery, check));
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const own = verify.eventId(payload);
    const eventId = own !== undefined && own.length <= EVENT_ID_MAX ? own : sha256;
    let stored: Awaited<ReturnType<typeof storeWebhookDelivery>>;
    try {
      stored = await deps.store(provider, eventId, payload, sha256);
    } catch (error) {
      logger.log('error', 'webhooks.store_failed', { requestId, provider, error });
      return refuse('integration_unavailable', requestId);
    }

    if (!stored.repeated) {
      const config = deps.qstash();
      if (config === undefined) {
        deps.later(() =>
          deps.process(stored.inboxId, { requestId }).catch((error: unknown) => {
            logger.log('error', 'webhooks.process_failed', {
              requestId,
              provider,
              inboxId: stored.inboxId,
              error,
            });
          }),
        );
      } else {
        try {
          await deps.publish(config, stored.inboxId, stored.inboxId);
        } catch (error) {
          logger.log('warn', 'webhooks.publish_failed', {
            requestId,
            provider,
            inboxId: stored.inboxId,
            error,
          });
        }
      }
    }
    logger.log('info', 'webhooks.received', {
      requestId,
      provider,
      inboxId: stored.inboxId,
      repeated: stored.repeated,
    });
    const ack: WebhookAck = { received: true };
    return Response.json(ack, { headers: headersFor(requestId) });
  };
}

/**
 * Meta's subscription check (`GET`, docs/06-api.md §3.4): the challenge as text for our verify
 * phrase, `403 forbidden` for any other, `503` while the route is not set up.
 */
export function metaHandshake(
  provider: 'meta_whatsapp' | 'meta_leadgen',
  verify: WebhookVerifier<{ verifyToken: string }>,
  deps: Partial<Pick<WebhookDeps, 'env' | 'receiverConfigured'>> = {},
): (request: Request) => Response {
  return (request) => {
    const requestId = incomingRequestId(request.headers);
    const secrets = verify.secrets(deps.env ?? process.env);
    const configured = (deps.receiverConfigured ?? webhookReceiverConfigured)();
    if (secrets === undefined || !configured) return refuse('integration_unavailable', requestId);
    const challenge = metaChallenge(new URL(request.url).searchParams, secrets.verifyToken);
    if (challenge === undefined) {
      logger.log('warn', 'webhooks.handshake_refused', { requestId, provider });
      return refuse('forbidden', requestId);
    }
    return new Response(challenge, {
      headers: { ...headersFor(requestId), 'content-type': 'text/plain; charset=utf-8' },
    });
  };
}
