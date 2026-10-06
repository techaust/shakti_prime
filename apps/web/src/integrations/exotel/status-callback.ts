import { ExotelCallStatusWebhook } from '@shakti/contracts';
import { asObject, hmacSha256Hex, safeEqual } from '../http';

/**
 * Verifying Exotel's call-status callback (docs/06-api.md §3.4, `POST /webhooks/exotel/call-status`).
 *
 * Exotel does not sign its callbacks with a header the BOS could check, so the BOS signs the
 * callback address instead: each dial gets a StatusCallback URL carrying the BOS call reference,
 * an expiry and an HMAC-SHA256 of both under `EXOTEL_CALLBACK_SECRET`. A callback is accepted
 * only when that signature matches, it has not expired, and its CallSid is the one the dial
 * returned for that reference (checked by the worker against the stored call). The secret never
 * leaves the BOS, and a callback address copied from one call opens no other.
 */

/** Late callbacks arrive after long calls and Exotel's retries; a day covers both. */
export const CALLBACK_LIFETIME_SECONDS = 24 * 60 * 60;

const REF_PATTERN = /^[0-9a-f-]{36}$/;

function signature(secret: string, ref: string, expires: number): string {
  return hmacSha256Hex(secret, `exotel-status.${ref}.${String(expires)}`);
}

/** The StatusCallback address for one dial. `ref` is the BOS call id (a UUID). */
export function signedStatusCallbackUrl(
  base: string,
  ref: string,
  secret: string,
  now: Date,
): string {
  if (!REF_PATTERN.test(ref)) throw new Error('the call reference must be a UUID');
  const expires = Math.floor(now.getTime() / 1000) + CALLBACK_LIFETIME_SECONDS;
  const url = new URL(base);
  url.searchParams.set('ref', ref);
  url.searchParams.set('exp', String(expires));
  url.searchParams.set('sig', signature(secret, ref, expires));
  return url.toString();
}

export type CallbackCheck =
  { ok: true; ref: string } | { ok: false; problem: 'unsigned' | 'bad_signature' | 'expired' };

/** Checks the address a callback arrived on. */
export function verifyStatusCallbackUrl(url: string, secret: string, now: Date): CallbackCheck {
  const params = new URL(url).searchParams;
  const ref = params.get('ref') ?? '';
  const exp = params.get('exp') ?? '';
  const sig = params.get('sig') ?? '';
  if (ref === '' || exp === '' || sig === '' || !/^\d{1,12}$/.test(exp)) {
    return { ok: false, problem: 'unsigned' };
  }
  const expires = Number(exp);
  if (!safeEqual(sig, signature(secret, ref, expires))) {
    return { ok: false, problem: 'bad_signature' };
  }
  if (expires < Math.floor(now.getTime() / 1000)) return { ok: false, problem: 'expired' };
  return { ok: true, ref };
}

/** The final states Exotel reports for a call. */
export const TERMINAL_CALL_STATES = [
  'completed',
  'failed',
  'busy',
  'no-answer',
  'canceled',
] as const;
export type TerminalCallState = (typeof TERMINAL_CALL_STATES)[number];

export interface CallStatusEvent {
  callSid: string;
  status: TerminalCallState | 'other';
  /** Seconds the customer was on the line, when Exotel reports it. */
  conversationSeconds: number | undefined;
  /** Where Exotel keeps the recording; a worker copies it to S3 and never stores this link. */
  recordingUrl: string | undefined;
  /** The BOS call id echoed back through CustomField. */
  customField: string | undefined;
  /** Exotel's timestamp for ordering out-of-order callbacks. */
  updatedAt: string;
}

/**
 * Exotel documents every value as a string, but a JSON callback may carry durations as numbers;
 * numbers become strings and the status is lower-cased before the contract reads the body.
 */
function asExotelStrings(value: unknown): unknown {
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(asExotelStrings);
  const object = asObject(value);
  if (object === undefined) return value;
  return Object.fromEntries(
    Object.entries(object).map(([key, v]) => [
      key,
      key === 'Status' && typeof v === 'string' ? v.toLowerCase() : asExotelStrings(v),
    ]),
  );
}

function seconds(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

/**
 * Reads a callback body, JSON (as the dial asks for) or form-encoded (Exotel's default), through
 * the published `ExotelCallStatusWebhook` contract. Answers undefined when the body is not one.
 */
export function parseStatusCallback(
  rawBody: string,
  contentType: string | null,
): CallStatusEvent | undefined {
  let body: unknown;
  if ((contentType ?? '').includes('application/json')) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return undefined;
    }
  } else {
    body = Object.fromEntries(new URLSearchParams(rawBody));
  }
  const parsed = ExotelCallStatusWebhook.safeParse(asExotelStrings(body));
  if (!parsed.success) return undefined;
  const callback = parsed.data;
  const onCall = (callback.Legs ?? [])
    .map((leg) => seconds(leg.OnCallDuration))
    .filter((n): n is number => n !== undefined);
  const nonEmpty = (text: string | undefined) => (text === '' ? undefined : text);
  return {
    callSid: callback.CallSid,
    status: (TERMINAL_CALL_STATES as readonly string[]).includes(callback.Status)
      ? (callback.Status as TerminalCallState)
      : 'other',
    conversationSeconds:
      seconds(callback.ConversationDuration) ??
      (onCall.length > 0 ? Math.max(...onCall) : undefined),
    recordingUrl: nonEmpty(callback.RecordingUrl),
    customField: nonEmpty(callback.CustomField),
    updatedAt: callback.DateUpdated,
  };
}
