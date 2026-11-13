import type { WebhookProvider } from '@shakti/contracts';
import { asArray, asObject, asString, at } from '../integrations/http';
import {
  checkExotelIncoming,
  checkExotelStatus,
  checkGoogleKey,
  checkLiveKit,
  checkMetaSignature,
  type CheckResult,
} from './checks';

/** Meta batches messages and statuses into one delivery, up to a few hundred kilobytes. */
export const META_BODY_MAX_BYTES = 256 * 1024;
/** Every other provider sends one event of a few kilobytes. */
export const WEBHOOK_BODY_MAX_BYTES = 64 * 1024;

/** One delivery as it arrived: the raw bytes, read once, and what the route knows of it. */
export interface Delivery {
  raw: Uint8Array;
  text: string;
  url: string;
  headers: Headers;
  /** The route's path parameters (Exotel's inbound secret). */
  params: Readonly<Record<string, string>>;
}

/**
 * How one provider's deliveries are checked and stored (docs/03-roadmap-appendix/phase2.md §5.1):
 * its body cap, its secrets (none while unset: the route then answers `integration_unavailable`,
 * question 13), its check, the payload kept, and the provider's own event id, which makes a
 * repeated delivery the same row.
 */
export interface WebhookVerifier<S> {
  maxBytes: number;
  secrets(env: NodeJS.ProcessEnv): S | undefined;
  check(delivery: Delivery, secrets: S, now: Date): Promise<CheckResult & { ref?: string }>;
  payload(delivery: Delivery, check: { ref?: string }): unknown;
  /** The provider's event id, or undefined to key the row on the body's SHA-256. */
  eventId(payload: unknown): string | undefined;
}

const set = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value;

/** JSON, or the text itself when it is not: the worker's contract then refuses it, visibly. */
function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Exotel posts form fields by default and JSON when the dial asks for it. */
function formOrJson(delivery: Delivery): unknown {
  const type = delivery.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return jsonOrText(delivery.text);
  return Object.fromEntries(new URLSearchParams(delivery.text));
}

function firstString(value: unknown, ...path: (string | number)[]): string | undefined {
  const found = asString(at(value, ...path));
  return found === undefined || found === '' ? undefined : found;
}

const metaWhatsApp: WebhookVerifier<{ appSecret: string; verifyToken: string }> = {
  maxBytes: META_BODY_MAX_BYTES,
  secrets: (env) => {
    const appSecret = set(env.WHATSAPP_APP_SECRET);
    const verifyToken = set(env.WHATSAPP_VERIFY_TOKEN);
    return appSecret === undefined || verifyToken === undefined
      ? undefined
      : { appSecret, verifyToken };
  },
  check: (d, s) =>
    Promise.resolve(checkMetaSignature(d.raw, d.headers.get('x-hub-signature-256'), s.appSecret)),
  payload: (d) => jsonOrText(d.text),
  // A delivery batches messages and statuses; each is made idempotent by its own id downstream.
  eventId: () => undefined,
};

const metaLeadgen: WebhookVerifier<{ appSecret: string; verifyToken: string }> = {
  ...metaWhatsApp,
  secrets: (env) => {
    const appSecret = set(env.META_LEADGEN_APP_SECRET);
    const verifyToken = set(env.META_LEADGEN_VERIFY_TOKEN);
    return appSecret === undefined || verifyToken === undefined
      ? undefined
      : { appSecret, verifyToken };
  },
  // One lead per delivery is Meta's usual shape; a batch is keyed on its body instead.
  eventId: (payload) => {
    const changes = asArray(asObject(payload)?.entry).flatMap((e) => asArray(asObject(e)?.changes));
    return changes.length === 1 ? firstString(changes[0], 'value', 'leadgen_id') : undefined;
  },
};

const googleLeadform: WebhookVerifier<{ key: string }> = {
  maxBytes: WEBHOOK_BODY_MAX_BYTES,
  secrets: (env) => {
    const key = set(env.GOOGLE_LEADFORM_KEY);
    return key === undefined ? undefined : { key };
  },
  check: (d, s) => Promise.resolve(checkGoogleKey(jsonOrText(d.text), s.key)),
  payload: (d) => jsonOrText(d.text),
  eventId: (payload) => firstString(payload, 'lead_id'),
};

const exotelStatus: WebhookVerifier<{ secret: string }> = {
  maxBytes: WEBHOOK_BODY_MAX_BYTES,
  secrets: (env) => {
    const secret = set(env.EXOTEL_CALLBACK_SECRET);
    return secret === undefined ? undefined : { secret };
  },
  check: (d, s, now) => Promise.resolve(checkExotelStatus(d.url, s.secret, now)),
  // The call reference the signed address carried is kept beside Exotel's fields, as `bos_ref`;
  // a body that names its own is overwritten, since only the address was signed.
  payload: (d, check) => {
    const body = asObject(formOrJson(d));
    return { ...(body ?? { body: d.text }), bos_ref: check.ref ?? null };
  },
  // A call reports each status once; the status keeps a later state from being taken for a repeat.
  eventId: (payload) => {
    const sid = firstString(payload, 'CallSid');
    const status = firstString(payload, 'Status');
    return sid === undefined || status === undefined ? undefined : `${sid}:${status.toLowerCase()}`;
  },
};

const exotelIncoming: WebhookVerifier<{ secret: string }> = {
  maxBytes: WEBHOOK_BODY_MAX_BYTES,
  secrets: (env) => {
    const secret = set(env.EXOTEL_INCOMING_SECRET);
    return secret === undefined ? undefined : { secret };
  },
  check: (d, s) => Promise.resolve(checkExotelIncoming(d.params.secret ?? '', s.secret)),
  payload: (d) => formOrJson(d),
  eventId: (payload) => firstString(payload, 'CallSid'),
};

const livekit: WebhookVerifier<{ apiKey: string; apiSecret: string }> = {
  maxBytes: WEBHOOK_BODY_MAX_BYTES,
  secrets: (env) => {
    const apiKey = set(env.LIVEKIT_API_KEY);
    const apiSecret = set(env.LIVEKIT_API_SECRET);
    return apiKey === undefined || apiSecret === undefined ? undefined : { apiKey, apiSecret };
  },
  check: (d, s, now) =>
    checkLiveKit(d.raw, d.headers.get('authorization'), s.apiKey, s.apiSecret, now),
  payload: (d) => jsonOrText(d.text),
  eventId: (payload) => firstString(payload, 'id'),
};

/** Each provider's verifier, by the provider it stores its deliveries under. */
export const WEBHOOK_VERIFIERS = {
  meta_whatsapp: metaWhatsApp,
  meta_leadgen: metaLeadgen,
  google_leadform: googleLeadform,
  exotel_status: exotelStatus,
  exotel_incoming: exotelIncoming,
  livekit,
} as const satisfies Record<WebhookProvider, unknown>;
