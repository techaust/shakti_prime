import { newId, type WebhookProvider } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  openLoopOffsets,
  percentiles,
  sendLag,
  storedOnce,
  type Percentiles,
  type StoredOnce,
} from '../../scripts/measures/stats';
import exotelStatus from '../../src/integrations/exotel/fixtures/status-callback.json';
import {
  exotelIncomingDelivery,
  exotelStatusDelivery,
  googleDelivery,
  leadgenDelivery,
  livekitDelivery,
  whatsappDelivery,
  type SignedDelivery,
  type WebhookSigningEnv,
} from '../../src/webhooks/signed-deliveries';

/**
 * Webhook answer times under load (docs/03-roadmap-appendix/phase2.md §5.1 and §8.1): at each rate
 * (20, 50 and 100 deliveries a second by default) an open-loop run sends the six providers'
 * recorded payloads in turn, each signed as its provider signs it and with an event id no other
 * run has, and one delivery in ten again as a repeat of an earlier one. Each answer's time is
 * taken from the send to the end of its body. Afterwards, on the local database, every delivery
 * must be stored exactly once (a repeat stores nothing more). The route's own budget is an answer
 * within 2 seconds (§5.1).
 */

export const WEBHOOK_ANSWER_TARGET_MS = 2_000;
const PROVIDERS: readonly WebhookProvider[] = [
  'meta_whatsapp',
  'meta_leadgen',
  'google_leadform',
  'exotel_status',
  'exotel_incoming',
  'livekit',
];
/** One delivery in this many is sent again, a few deliveries after the first. */
const REPEAT_EVERY = 10;
const REPEAT_BACK = 5;
/** A delivery's answer is waited for this long; longer is counted as failed. */
const ANSWER_TIMEOUT_MS = 15_000;

interface Planned {
  provider: WebhookProvider;
  eventId: string;
  request: () => Request;
}

/** The status Exotel's recorded callback carries, which its event id ends with. */
const EXOTEL_STATUS = exotelStatus.Status.toLowerCase();

/** A signed delivery of `provider` and the event id the route stores it under. */
async function plan(
  provider: WebhookProvider,
  env: WebhookSigningEnv,
  now: Date,
): Promise<Planned> {
  const unique = newId();
  let delivery: SignedDelivery;
  let eventId: string;
  switch (provider) {
    case 'meta_whatsapp': {
      delivery = whatsappDelivery(unique, undefined, env);
      // A WhatsApp delivery is keyed on its body's SHA-256: it batches events with no single id.
      const body = await delivery.request().text();
      eventId = createHash('sha256').update(body).digest('hex');
      break;
    }
    case 'meta_leadgen':
      delivery = leadgenDelivery(unique, env);
      eventId = unique;
      break;
    case 'google_leadform':
      delivery = googleDelivery(unique, env.GOOGLE_LEADFORM_KEY);
      eventId = unique;
      break;
    case 'exotel_status':
      delivery = exotelStatusDelivery(unique, now, env);
      eventId = `${unique}:${EXOTEL_STATUS}`;
      break;
    case 'exotel_incoming':
      delivery = exotelIncomingDelivery(unique, env.EXOTEL_INCOMING_SECRET);
      eventId = unique;
      break;
    case 'livekit':
      delivery = await livekitDelivery(unique, now, env);
      eventId = `EV_${unique}`;
      break;
  }
  return { provider, eventId, request: delivery.request };
}

/** The same request sent to `baseUrl` instead: no provider signs the address's origin. */
async function toBase(request: Request, baseUrl: string): Promise<Request> {
  const from = new URL(request.url);
  const url = new URL(`${from.pathname}${from.search}`, baseUrl);
  const body = request.method === 'GET' ? undefined : await request.arrayBuffer();
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    ...(body === undefined ? {} : { body }),
  });
}

interface Sent {
  provider: WebhookProvider;
  ms: number;
  status: number;
  repeat: boolean;
}

export interface RateResult {
  rate: number;
  seconds: number;
  sent: number;
  repeats: number;
  answers: Percentiles;
  byProvider: Record<string, Percentiles>;
  /** Answers other than 200, by status (0: no answer in time or a network error). */
  notOk: Record<string, number>;
  /** How late the generator sent against its plan: a large lag means the figures are its own. */
  sendLag: Percentiles;
  /** The local database's count; absent against another server. */
  stored?: StoredOnce;
}

/** One open-loop run at `rate` a second for `seconds`. */
export async function loadAtRate(options: {
  baseUrl: string;
  rate: number;
  seconds: number;
  env: WebhookSigningEnv;
  /** Count the stored rows on the local database. */
  countStored: boolean;
}): Promise<RateResult> {
  const offsets = openLoopOffsets(options.rate, options.seconds);
  const now = new Date();
  // Planned and signed before the clock starts, so signing takes none of the run's time.
  const fresh: Planned[] = [];
  for (let i = 0; i < offsets.length; i += 1) {
    fresh.push(await plan(PROVIDERS[i % PROVIDERS.length] ?? 'meta_whatsapp', options.env, now));
  }
  const deliveries = offsets.map((_, i) => {
    const repeat = i % REPEAT_EVERY === REPEAT_EVERY - 1 && i >= REPEAT_BACK;
    const item = repeat ? fresh[i - REPEAT_BACK] : fresh[i];
    if (item === undefined) throw new Error('no delivery planned');
    return { item, repeat };
  });
  const requests = await Promise.all(
    deliveries.map(({ item }) => toBase(item.request(), options.baseUrl)),
  );

  const sentAt: number[] = [];
  const results: Promise<Sent>[] = [];
  const start = performance.now();
  for (let i = 0; i < deliveries.length; i += 1) {
    const due = start + (offsets[i] ?? 0);
    const wait = due - performance.now();
    if (wait > 1) await sleep(wait);
    const { item, repeat } = deliveries[i] ?? { item: undefined, repeat: false };
    const request = requests[i];
    if (item === undefined || request === undefined) continue;
    const t0 = performance.now();
    sentAt.push(t0 - start);
    results.push(
      fetch(request, { signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS) })
        .then(async (answer) => {
          await answer.arrayBuffer();
          return {
            provider: item.provider,
            ms: performance.now() - t0,
            status: answer.status,
            repeat,
          };
        })
        .catch(() => ({ provider: item.provider, ms: performance.now() - t0, status: 0, repeat })),
    );
  }
  const sent = await Promise.all(results);

  const notOk: Record<string, number> = {};
  for (const s of sent) {
    if (s.status !== 200) notOk[String(s.status)] = (notOk[String(s.status)] ?? 0) + 1;
  }
  const byProvider: Record<string, Percentiles> = {};
  for (const provider of PROVIDERS) {
    byProvider[provider] = percentiles(
      sent.filter((s) => s.provider === provider).map((s) => s.ms),
    );
  }
  const result: RateResult = {
    rate: options.rate,
    seconds: options.seconds,
    sent: sent.length,
    repeats: deliveries.filter((d) => d.repeat).length,
    answers: percentiles(sent.map((s) => s.ms)),
    byProvider,
    notOk,
    sendLag: sendLag(offsets, sentAt),
  };
  if (options.countStored) {
    // In-process processing runs after each answer; the rows are written before it, by the route.
    const ids = deliveries.map((d) => d.item.eventId);
    const held = await asMigrator(
      (m) => m<{ provider_event_id: string }[]>`
        select provider_event_id from webhook_inbox where provider_event_id = any(${ids})`,
    );
    result.stored = storedOnce(
      ids,
      held.map((r) => r.provider_event_id),
    );
  }
  return result;
}
