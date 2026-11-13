import { createHash } from 'node:crypto';
import { jwtVerify } from 'jose';
import { asObject, asString, safeEqual } from '../integrations/http';
import { verifyStatusCallbackUrl } from '../integrations/exotel/status-callback';
import { verifyHubSignature } from '../integrations/whatsapp/webhook';

/**
 * The check each provider's delivery must pass before anything is stored
 * (docs/03-roadmap-appendix/phase2.md §5.1). Every comparison with a secret is made in constant
 * time; a check never throws and never says more than its problem's name, which goes to the log
 * and the refused count, never to the caller. Every check refuses an empty secret first, since an
 * HMAC or a token made with an empty key is one anyone can make.
 */

export type CheckProblem =
  | 'no_secret'
  | 'unsigned'
  | 'bad_signature'
  | 'expired'
  | 'bad_key'
  | 'bad_token'
  | 'bad_body_hash';

export type CheckResult = { ok: true } | { ok: false; problem: CheckProblem };

const OK: CheckResult = { ok: true };
const refused = (problem: CheckProblem): CheckResult => ({ ok: false, problem });

/** Meta (WhatsApp and Lead Ads): `X-Hub-Signature-256`, the HMAC-SHA256 of the raw body. */
export function checkMetaSignature(
  raw: Uint8Array,
  header: string | null,
  appSecret: string,
): CheckResult {
  if (appSecret === '') return refused('no_secret');
  if (header === null || header === '') return refused('unsigned');
  return verifyHubSignature(raw, header, appSecret) ? OK : refused('bad_signature');
}

/** Meta's subscription handshake: the challenge, only for our verify phrase. */
export function metaChallenge(params: URLSearchParams, verifyToken: string): string | undefined {
  if (params.get('hub.mode') !== 'subscribe') return undefined;
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge') ?? '';
  if (challenge === '' || challenge.length > 200 || verifyToken === '') return undefined;
  return safeEqual(token, verifyToken) ? challenge : undefined;
}

/** Google's lead form: the form's key arrives in the body as `google_key`. */
export function checkGoogleKey(body: unknown, key: string): CheckResult {
  if (key === '') return refused('no_secret');
  const given = asString(asObject(body)?.google_key);
  if (given === undefined || given === '') return refused('unsigned');
  return safeEqual(given, key) ? OK : refused('bad_key');
}

/**
 * Exotel's call status: the BOS signed the callback address of each dial (`status-callback.ts`);
 * answers the call reference the address carries.
 */
export function checkExotelStatus(
  url: string,
  secret: string,
  now: Date,
): CheckResult & { ref?: string } {
  if (secret === '') return refused('no_secret');
  const check = verifyStatusCallbackUrl(url, secret, now);
  return check.ok ? { ok: true, ref: check.ref } : refused(check.problem);
}

/** Exotel's inbound applet signs nothing: its address carries a secret path segment. */
export function checkExotelIncoming(segment: string, secret: string): CheckResult {
  if (secret === '') return refused('no_secret');
  if (segment === '') return refused('unsigned');
  return safeEqual(segment, secret) ? OK : refused('bad_key');
}

/** How far LiveKit's clock may be from ours when its token's times are read. */
const LIVEKIT_CLOCK_TOLERANCE_SECONDS = 60;

/**
 * LiveKit: `Authorization` carries a JWT signed with the project's API secret (HS256), issued by
 * its API key, whose `sha256` claim is the base64 SHA-256 of the raw body.
 */
export async function checkLiveKit(
  raw: Uint8Array,
  authorization: string | null,
  apiKey: string,
  apiSecret: string,
  now: Date,
): Promise<CheckResult> {
  if (apiKey === '' || apiSecret === '') return refused('no_secret');
  if (authorization === null || authorization.trim() === '') return refused('unsigned');
  const token = authorization.trim().replace(/^Bearer\s+/i, '');
  let claimed: unknown;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(apiSecret), {
      algorithms: ['HS256'],
      issuer: apiKey,
      currentDate: now,
      clockTolerance: LIVEKIT_CLOCK_TOLERANCE_SECONDS,
    });
    claimed = payload.sha256;
  } catch {
    return refused('bad_token');
  }
  if (typeof claimed !== 'string') return refused('bad_body_hash');
  const hash = createHash('sha256').update(raw).digest('base64');
  return safeEqual(claimed, hash) ? OK : refused('bad_body_hash');
}
