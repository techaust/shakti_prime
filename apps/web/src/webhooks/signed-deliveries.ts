import { newId, type WebhookProvider } from '@shakti/contracts';
import { SignJWT } from 'jose';
import { createHash, createHmac } from 'node:crypto';
import { signedStatusCallbackUrl } from '../integrations/exotel/status-callback';
import exotelStatus from '../integrations/exotel/fixtures/status-callback.json';
import whatsappInbound from '../integrations/whatsapp/fixtures/inbound-text.json';
import exotelIncoming from './fixtures/exotel-incoming.json';
import googleLeadform from './fixtures/google-leadform.json';
import leadgen from './fixtures/leadgen.json';
import livekit from './fixtures/livekit.json';

/**
 * Signed deliveries of all six providers for the webhook tests (docs/03-roadmap-appendix/phase2.md
 * §5.1): recorded payloads (WhatsApp, Exotel's status) and generated ones shaped as the providers'
 * references describe them, each signed as its provider signs it with the low-entropy test
 * secrets below, which no environment uses. `unique` gives each delivery an event id no other run
 * has, so a test on the shared database sees its own row.
 */
export const TEST_WEBHOOK_ENV = {
  WHATSAPP_APP_SECRET: 'meta app secret for the webhook tests',
  WHATSAPP_VERIFY_TOKEN: 'whatsapp verify phrase for the webhook tests',
  META_LEADGEN_APP_SECRET: 'lead ads app secret for the webhook tests',
  META_LEADGEN_VERIFY_TOKEN: 'lead ads verify phrase for the webhook tests',
  GOOGLE_LEADFORM_KEY: 'google form key for the webhook tests',
  EXOTEL_CALLBACK_SECRET: 'exotel callback secret for the webhook tests',
  EXOTEL_INCOMING_SECRET: 'exotel-incoming-path-for-the-webhook-tests',
  LIVEKIT_API_KEY: 'livekit key for the webhook tests',
  LIVEKIT_API_SECRET: 'livekit secret for the webhook tests',
} as const;

export const TEST_ORIGIN = 'http://localhost:3000';

export interface SignedDelivery {
  provider: WebhookProvider;
  request: () => Request;
  /** The same delivery with one byte of its body changed and its signature kept. */
  tampered: () => Request;
  /** The route's path parameters. */
  params: Record<string, string>;
  /** The path parameters of the tampered request, when they differ. */
  tamperedParams?: Record<string, string>;
}

const encoder = new TextEncoder();

function changeOneByte(body: string): string {
  const i = body.lastIndexOf('0');
  return i < 0 ? `${body} ` : `${body.slice(0, i)}1${body.slice(i + 1)}`;
}

function post(url: string, body: string, headers: Record<string, string>): Request {
  return new Request(url, { method: 'POST', body, headers });
}

function metaDelivery(
  provider: 'meta_whatsapp' | 'meta_leadgen',
  path: string,
  payload: unknown,
  secret: string,
): SignedDelivery {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const headers = { 'content-type': 'application/json', 'x-hub-signature-256': signature };
  return {
    provider,
    params: {},
    request: () => post(`${TEST_ORIGIN}${path}`, body, headers),
    tampered: () => post(`${TEST_ORIGIN}${path}`, changeOneByte(body), headers),
  };
}

/** A WhatsApp delivery; `unique` changes its message id, so its body (its key) is new. */
export function whatsappDelivery(unique: string = newId(), payload?: unknown): SignedDelivery {
  const body =
    payload ??
    (JSON.parse(
      JSON.stringify(whatsappInbound).replace(/"wamid\.[^"]+"/, `"wamid.${unique}"`),
    ) as unknown);
  return metaDelivery(
    'meta_whatsapp',
    '/api/v1/webhooks/meta/whatsapp',
    body,
    TEST_WEBHOOK_ENV.WHATSAPP_APP_SECRET,
  );
}

export function leadgenDelivery(unique: string = newId()): SignedDelivery {
  const body = JSON.parse(JSON.stringify(leadgen).replace('444444444444', unique)) as unknown;
  return metaDelivery(
    'meta_leadgen',
    '/api/v1/webhooks/meta/leadgen',
    body,
    TEST_WEBHOOK_ENV.META_LEADGEN_APP_SECRET,
  );
}

export function googleDelivery(
  unique: string = newId(),
  key: string = TEST_WEBHOOK_ENV.GOOGLE_LEADFORM_KEY,
): SignedDelivery {
  const body = JSON.stringify({ ...googleLeadform, lead_id: unique, google_key: key });
  const url = `${TEST_ORIGIN}/api/v1/webhooks/google/leadform`;
  const headers = { 'content-type': 'application/json' };
  return {
    provider: 'google_leadform',
    params: {},
    request: () => post(url, body, headers),
    tampered: () => post(url, body.replace(key, changeOneByte(key)), headers),
  };
}

/** Exotel's status callback, form-encoded as Exotel sends it by default, on a signed address. */
export function exotelStatusDelivery(
  unique: string = newId(),
  now: Date = new Date(),
): SignedDelivery {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(exotelStatus)) {
    if (typeof value === 'string' || typeof value === 'number') fields[key] = String(value);
  }
  fields.CallSid = unique;
  fields.CustomField = unique;
  const body = new URLSearchParams(fields).toString();
  const url = signedStatusCallbackUrl(
    `${TEST_ORIGIN}/api/v1/webhooks/exotel/call-status`,
    unique,
    TEST_WEBHOOK_ENV.EXOTEL_CALLBACK_SECRET,
    now,
  );
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  return {
    provider: 'exotel_status',
    params: {},
    request: () => post(url, body, headers),
    // The address is what is signed: a changed reference is a changed byte.
    tampered: () => post(url.replace(unique, changeOneByte(unique)), body, headers),
  };
}

/** Exotel's Passthru applet: GET with the call's fields in the address, under the secret path. */
export function exotelIncomingDelivery(
  unique: string = newId(),
  secret: string = TEST_WEBHOOK_ENV.EXOTEL_INCOMING_SECRET,
): SignedDelivery {
  const query = new URLSearchParams({ ...exotelIncoming, CallSid: unique }).toString();
  const at = (segment: string) =>
    `${TEST_ORIGIN}/api/v1/webhooks/exotel/incoming/${segment}?${query}`;
  return {
    provider: 'exotel_incoming',
    params: { secret },
    tamperedParams: { secret: changeOneByte(secret) },
    request: () => new Request(at(secret), { method: 'GET' }),
    tampered: () => new Request(at(changeOneByte(secret)), { method: 'GET' }),
  };
}

/** LiveKit: a JWT from the API secret whose `sha256` claim is the body's base64 SHA-256. */
export async function livekitDelivery(
  unique: string = newId(),
  now: Date = new Date(),
): Promise<SignedDelivery> {
  const body = JSON.stringify({ ...livekit, id: `EV_${unique}` });
  const sha256 = createHash('sha256').update(body).digest('base64');
  const iat = Math.floor(now.getTime() / 1000);
  const token = await new SignJWT({ sha256 })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(TEST_WEBHOOK_ENV.LIVEKIT_API_KEY)
    .setNotBefore(iat)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(encoder.encode(TEST_WEBHOOK_ENV.LIVEKIT_API_SECRET));
  const url = `${TEST_ORIGIN}/api/v1/webhooks/livekit`;
  const headers = { 'content-type': 'application/webhook+json', authorization: token };
  return {
    provider: 'livekit',
    params: {},
    request: () => post(url, body, headers),
    tampered: () => post(url, changeOneByte(body), headers),
  };
}

/** One signed delivery of every provider. */
export async function everyProvider(now: Date = new Date()): Promise<SignedDelivery[]> {
  return [
    whatsappDelivery(),
    leadgenDelivery(),
    googleDelivery(),
    exotelStatusDelivery(newId(), now),
    exotelIncomingDelivery(),
    await livekitDelivery(newId(), now),
  ];
}
