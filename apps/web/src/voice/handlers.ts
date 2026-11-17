import {
  isDomainError,
  isStaffRole,
  newId,
  VOICE_AGENT_NAME,
  VoiceDispatchMetadata,
  VoiceSessionRequest,
  VoiceSessionResponse,
  VoiceTokenRequest,
  VoiceTokenResponse,
  type ErrorCode,
  type Principal,
  type VoiceSessionGrant,
  type VoiceTokenGrant,
} from '@shakti/contracts';
import { voiceSessionNotAfter, type ClientMeta, type KeyValue } from '@shakti/domain';
import { apiFailure } from '../api-failure';
import { clientMeta } from '../auth/client-address';
import { countRequest, type CapRule } from '../auth/request-cap';
import {
  liveKitConfig,
  liveKitRooms,
  liveKitToken,
  type LiveKitConfig,
  type LiveKitRooms,
} from '../integrations/voice/livekit';
import { logger } from '../log';
import { signingKeys, SigningKeyError, type Env, type SigningKeys } from '../realtime/keys';
import { bosIssuer } from '../realtime/token';
import { declaredTooLarge, readTextWithin } from '../request-body';
import { incomingRequestId } from '../request-id';
import { signVoiceGrant } from './token';

// Live voice's two routes (docs/06-api.md §3.1, docs/03-roadmap-appendix/phase2.md §7.5):
// `POST /api/v1/voice/session` starts a session for the signed-in person from the BOS's own
// screens, and `POST /api/v1/voice/token` gives the voice worker a new token for its live session.
// Each command settles and audits the claims; the routes only sign them and talk to LiveKit. With
// LiveKit or the signing keys not set (every Phase 2 integration on production until the final
// phase), a start is refused as "voice is not set up" before anything is written.

/** A session request is three small fields: well under this. */
export const VOICE_SESSION_BODY_MAX_BYTES = 1024;
/** The token call carries no fields: `{}` with some white space at most. */
const EMPTY_BODY_MAX_BYTES = 64;

/** Starts one person may make in five minutes: enough to try again, never a burst. */
export const VOICE_SESSION_CAP: CapRule = { window: 5 * 60, max: 10 };
/**
 * Refreshes one session may ask for in five minutes. The worker asks once a token's lifetime, a
 * minute before it ends; the rest is room for a retry after a dropped network.
 */
export const VOICE_TOKEN_CAP: CapRule = { window: 5 * 60, max: 10 };

/** How long a session's room waits for the person, and stays after they leave. */
export const VOICE_ROOM = {
  emptyTimeoutSeconds: 120,
  departureTimeoutSeconds: 20,
  // The person and the voice worker.
  maxParticipants: 2,
} as const;

const NO_STORE = { 'cache-control': 'no-store' };

const failure = apiFailure;

const reasonOf = (error: unknown): string | undefined => {
  const reason = isDomainError(error) ? error.details?.reason : undefined;
  return typeof reason === 'string' ? reason : undefined;
};

/** A command's refusal in the error envelope, with its reason; anything else is internal. */
function refusal(error: unknown, requestId: string, event: string): Response {
  const answered: readonly ErrorCode[] = ['validation_failed', 'forbidden', 'conflict'];
  if (isDomainError(error) && answered.includes(error.code)) {
    const reason = reasonOf(error);
    return failure(error.code, requestId, reason === undefined ? undefined : { reason });
  }
  logger.log('error', event, { requestId, error });
  return failure('internal', requestId);
}

/** The signing keys, or undefined when they are not set or cannot be read (logged, never the key). */
async function keysOf(env: Env, requestId: string): Promise<SigningKeys | undefined> {
  try {
    return await signingKeys(env);
  } catch (error) {
    const problem = error instanceof SigningKeyError ? error.message : 'unreadable';
    logger.log('error', 'voice.keys_invalid', { requestId, problem });
    return undefined;
  }
}

async function capped(
  keyValue: KeyValue,
  key: string,
  rule: CapRule,
  requestId: string,
): Promise<Response | undefined> {
  try {
    const counted = await countRequest(keyValue, key, rule);
    if (counted.allowed) return undefined;
    return failure('rate_limited', requestId, undefined, {
      'retry-after': String(counted.retryAfter),
    });
  } catch (error) {
    logger.log('error', 'voice.cap_failed', { requestId, error });
    return failure('integration_unavailable', requestId);
  }
}

export interface SessionRouteDeps {
  /** The signed-in caller; undefined without a session. May throw `unauthorized` (`totp_required`). */
  principal: () => Promise<Principal | undefined>;
  /** Runs `voice.session.start` as the person, which checks the limits and writes the session. */
  start: (
    principal: Principal,
    input: VoiceSessionRequest,
    meta: { requestId: string; client: ClientMeta },
  ) => Promise<VoiceSessionGrant>;
  keyValue: KeyValue;
  /** LiveKit's room service for the project; the real one over HTTP unless a test passes one. */
  rooms?: (config: LiveKitConfig) => LiveKitRooms;
  env?: Env;
  now?: () => Date;
}

/** `POST /api/v1/voice/session`: a "Talk to Shakti" session for the signed-in person. */
export async function startVoiceSessionRoute(
  request: Request,
  deps: SessionRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const env = deps.env ?? process.env;
  const issuer = bosIssuer(env);
  // Only the BOS's own screens start a session with the cookie (as the Realtime token route).
  if (issuer !== undefined && request.headers.get('origin') !== issuer) {
    return failure('forbidden', requestId);
  }
  if (declaredTooLarge(request.headers, VOICE_SESSION_BODY_MAX_BYTES)) {
    return failure('validation_failed', requestId);
  }

  let principal: Principal | undefined;
  try {
    principal = await deps.principal();
  } catch (error) {
    if (isDomainError(error) && error.code === 'unauthorized') {
      const reason = reasonOf(error);
      return failure('unauthorized', requestId, reason === undefined ? undefined : { reason });
    }
    logger.log('error', 'voice.principal_failed', { requestId, error });
    return failure('internal', requestId);
  }
  if (principal === undefined) return failure('unauthorized', requestId);
  if (
    principal.kind !== 'user' ||
    !isStaffRole(principal.roleKey) ||
    principal.entityIds.length === 0
  ) {
    return failure('forbidden', requestId);
  }

  // Voice is set up only with LiveKit, the signing keys and the issuer; otherwise nothing starts.
  const config = liveKitConfig(env);
  const keys = await keysOf(env, requestId);
  if (config === undefined || keys === undefined || issuer === undefined) {
    return failure('integration_unavailable', requestId, { reason: 'voice_unavailable' });
  }

  const limited = await capped(
    deps.keyValue,
    `voice-session:${principal.id}`,
    VOICE_SESSION_CAP,
    requestId,
  );
  if (limited !== undefined) return limited;

  let input: VoiceSessionRequest;
  try {
    const text = await readTextWithin(request, VOICE_SESSION_BODY_MAX_BYTES);
    const parsed = VoiceSessionRequest.safeParse(JSON.parse(text ?? ''));
    if (!parsed.success) return failure('validation_failed', requestId);
    input = parsed.data;
  } catch {
    return failure('validation_failed', requestId);
  }

  const client = clientMeta(request.headers);
  let grant: VoiceSessionGrant;
  try {
    grant = await deps.start(principal, input, { requestId, client });
  } catch (error) {
    return refusal(error, requestId, 'voice.start_failed');
  }

  try {
    const now = (deps.now ?? (() => new Date()))();
    const bos = await signVoiceGrant(
      {
        jti: newId(),
        sub: grant.sub,
        sid: grant.sessionId,
        bos_role: grant.bos_role,
        entity_ids: grant.entity_ids,
      },
      voiceSessionNotAfter(new Date(grant.startedAt)),
      keys,
      { issuer, now },
    );
    const metadata = VoiceDispatchMetadata.parse({
      sessionId: grant.sessionId,
      apiBase: new URL('/api/v1', issuer).toString(),
      bosToken: { token: bos.token, expiresAt: bos.expiresAt.toISOString() },
      mode: grant.mode,
      consentRecording: grant.consentRecording,
      limits: grant.limits,
    });
    const rooms = (deps.rooms ?? liveKitRooms)(config);
    await rooms.createAgentRoom(grant.sessionId, {
      ...VOICE_ROOM,
      agentName: VOICE_AGENT_NAME,
      agentMetadata: JSON.stringify(metadata),
    });
    const joinSeconds = grant.limits.maxSessionMinutes * 60;
    const participantToken = await liveKitToken(
      config,
      `user:${grant.sub}`,
      {
        roomJoin: true,
        room: grant.sessionId,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
      joinSeconds,
      now,
    );
    const body = VoiceSessionResponse.parse({
      sessionId: grant.sessionId,
      livekit: {
        url: config.url,
        roomName: grant.sessionId,
        participantToken,
        expiresAt: new Date(
          Math.floor(now.getTime() / 1000) * 1000 + joinSeconds * 1000,
        ).toISOString(),
      },
      bosToken: { token: bos.token, expiresAt: bos.expiresAt.toISOString() },
      limits: {
        minutesRemainingToday: grant.limits.minutesRemainingToday,
        maxSessionMinutes: grant.limits.maxSessionMinutes,
      },
    });
    return Response.json(body, { headers: { ...NO_STORE, 'x-request-id': requestId } });
  } catch (error) {
    // The session is written but has no room: it is no longer live once its longest length has
    // passed, and the person's next start ends it.
    logger.log('error', 'voice.room_failed', { requestId, sessionId: grant.sessionId, error });
    return failure('integration_unavailable', requestId, { reason: 'voice_unavailable' });
  }
}

export interface TokenRouteDeps {
  /** The voice principal a token speaks for, while its session is live; undefined otherwise. */
  voicePrincipal: (token: string) => Promise<{ principal: Principal } | undefined>;
  /** Runs `voice.session.token` as the voice principal, which checks the session again. */
  refresh: (
    principal: Principal,
    meta: { requestId: string; client: ClientMeta },
  ) => Promise<VoiceTokenGrant>;
  keyValue: KeyValue;
  env?: Env;
  now?: () => Date;
}

/** The token after `Bearer `, of the characters a JWT uses; undefined for anything else. */
function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (header === null) return undefined;
  return /^Bearer ([\w.~+/=-]{1,4096})$/.exec(header)?.[1];
}

/** `POST /api/v1/voice/token`: a new token for the caller's live session, from its current one. */
export async function refreshVoiceTokenRoute(
  request: Request,
  deps: TokenRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const env = deps.env ?? process.env;
  const issuer = bosIssuer(env);
  const keys = await keysOf(env, requestId);
  if (issuer === undefined || keys === undefined) {
    return failure('integration_unavailable', requestId, { reason: 'voice_unavailable' });
  }
  const token = bearerToken(request);
  if (token === undefined) return failure('unauthorized', requestId);
  if (declaredTooLarge(request.headers, EMPTY_BODY_MAX_BYTES)) {
    return failure('validation_failed', requestId);
  }

  let resolved: { principal: Principal } | undefined;
  try {
    resolved = await deps.voicePrincipal(token);
  } catch (error) {
    logger.log('error', 'voice.principal_failed', { requestId, error });
    return failure('internal', requestId);
  }
  if (resolved === undefined) return failure('unauthorized', requestId);
  const { principal } = resolved;

  const limited = await capped(
    deps.keyValue,
    `voice-token:${principal.voiceSessionId ?? principal.id}`,
    VOICE_TOKEN_CAP,
    requestId,
  );
  if (limited !== undefined) return limited;

  let text: string | undefined;
  try {
    text = await readTextWithin(request, EMPTY_BODY_MAX_BYTES);
  } catch {
    return failure('validation_failed', requestId);
  }
  if (text === undefined || !emptyBody(text)) return failure('validation_failed', requestId);

  let grant: VoiceTokenGrant;
  try {
    grant = await deps.refresh(principal, { requestId, client: clientMeta(request.headers) });
  } catch (error) {
    return refusal(error, requestId, 'voice.refresh_failed');
  }
  try {
    const minted = await signVoiceGrant(grant, new Date(grant.notAfter), keys, {
      issuer,
      now: (deps.now ?? (() => new Date()))(),
    });
    const body = VoiceTokenResponse.parse({
      token: minted.token,
      expiresAt: minted.expiresAt.toISOString(),
    });
    return Response.json(body, { headers: { ...NO_STORE, 'x-request-id': requestId } });
  } catch (error) {
    return refusal(error, requestId, 'voice.mint_failed');
  }
}

/** An empty body or `{}` only: the call carries no fields (`VoiceTokenRequest`). */
function emptyBody(text: string): boolean {
  if (text.trim() === '') return true;
  try {
    return VoiceTokenRequest.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}
