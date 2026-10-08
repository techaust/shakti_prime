import {
  isStaffRole,
  isDomainError,
  type Principal,
  type RealtimeTokenGrant,
} from '@shakti/contracts';
import type { ClientMeta, KeyValue } from '@shakti/domain';
import { apiFailure } from '../api-failure';
import { clientMeta } from '../auth/client-address';
import { countRequest, type CapRule } from '../auth/request-cap';
import { logger } from '../log';
import { declaredTooLarge, readTextWithin } from '../request-body';
import { incomingRequestId } from '../request-id';
import {
  JwksResponse,
  RealtimeTokenRequest,
  RealtimeTokenResponse,
  realtimeChannels,
} from './claims';
import { publicKeyList, signingKeys, SigningKeyError, type Env, type SigningKeys } from './keys';
import { bosIssuer, openIdConfiguration, signRealtimeGrant } from './token';

/**
 * How long a relying party may keep the key list. A rotation waits longer than this between
 * publishing the next key and signing with it (docs/runbooks/deploy.md).
 */
export const JWKS_MAX_AGE_SECONDS = 300;
const DISCOVERY_MAX_AGE_SECONDS = 3600;

const NO_STORE = 'no-store';

/**
 * Tokens one person may be issued in five minutes. A token lasts 15 minutes and each open screen
 * asks for its own, so this leaves room for many tabs and reconnects; each issue is audited, so
 * a runaway client must not fill the Activity log.
 */
export const REALTIME_TOKEN_CAP: CapRule = { window: 5 * 60, max: 20 };

const failure = apiFailure;

async function keysOrFailure(env: Env, requestId: string): Promise<SigningKeys | Response> {
  try {
    const keys = await signingKeys(env);
    if (keys !== undefined) return keys;
    logger.log('warn', 'realtime.keys_missing', { requestId });
  } catch (error) {
    // The message names the variable and the problem only, never the key.
    const problem = error instanceof SigningKeyError ? error.message : 'unreadable';
    logger.log('error', 'realtime.keys_invalid', { requestId, problem });
  }
  return failure('integration_unavailable', requestId);
}

/**
 * The most a body with no fields can take: `{}` with some white space. The request carries no
 * fields, so anything longer is refused unread.
 */
const EMPTY_BODY_MAX_BYTES = 64;

/** The call carries no fields (`RealtimeTokenRequest`): an empty body or `{}` only. */
async function bodyIsEmpty(request: Request): Promise<boolean> {
  let text: string | undefined;
  try {
    text = await readTextWithin(request, EMPTY_BODY_MAX_BYTES);
  } catch {
    return false;
  }
  if (text === undefined) return false;
  if (text.trim() === '') return true;
  try {
    return RealtimeTokenRequest.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}

export interface TokenRouteDeps {
  /** The signed-in caller; undefined without a session. May throw `unauthorized` (`totp_required`). */
  principal: () => Promise<Principal | undefined>;
  /**
   * Settles and audits the claims through `realtime.token.issue` (`issueGrantThroughCommand` in
   * the route); the route only signs what the command returned.
   */
  issue: (
    principal: Principal,
    meta: { requestId: string; client: ClientMeta },
  ) => Promise<RealtimeTokenGrant>;
  /** The shared store that counts each person's tokens against `REALTIME_TOKEN_CAP`. */
  keyValue: KeyValue;
  env?: Env;
  now?: () => Date;
}

/**
 * `POST /api/v1/realtime/token` (docs/06-api.md §3.1): a Realtime token for the signed-in person.
 * A call from another site is refused even with the cookie: the token is only for the BOS's own
 * screens. So is a call with no `Origin` at all: a browser always sends one on a POST, so only a
 * hand-made request lacks it. (Server actions let a missing `Origin` through with a warning; this
 * route is stricter because the session cookie is its only credential until the field app's
 * bearer tokens exist, and a bearer caller will be exempt from the check.)
 */
export async function issueRealtimeToken(
  request: Request,
  deps: TokenRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const env = deps.env ?? process.env;
  const issuer = bosIssuer(env);
  if (issuer === undefined) {
    logger.log('error', 'realtime.issuer_missing', { requestId });
    return failure('integration_unavailable', requestId);
  }
  if (request.headers.get('origin') !== issuer) return failure('forbidden', requestId);
  // A body this call never takes is refused before the session is looked up or anything is read.
  if (declaredTooLarge(request.headers, EMPTY_BODY_MAX_BYTES)) {
    return failure('validation_failed', requestId);
  }

  let principal: Principal | undefined;
  try {
    principal = await deps.principal();
  } catch (error) {
    if (isDomainError(error) && error.code === 'unauthorized') {
      const reason = error.details?.reason;
      return failure(
        'unauthorized',
        requestId,
        typeof reason === 'string' ? { reason } : undefined,
      );
    }
    logger.log('error', 'realtime.principal_failed', { requestId, error });
    return failure('internal', requestId);
  }
  if (principal === undefined) return failure('unauthorized', requestId);
  // A person with no entity in scope has no channel to open.
  if (
    principal.kind !== 'user' ||
    !isStaffRole(principal.roleKey) ||
    principal.entityIds.length === 0
  ) {
    return failure('forbidden', requestId);
  }

  let counted: Awaited<ReturnType<typeof countRequest>>;
  try {
    counted = await countRequest(
      deps.keyValue,
      `realtime-token:${principal.id}`,
      REALTIME_TOKEN_CAP,
    );
  } catch (error) {
    logger.log('error', 'realtime.cap_failed', { requestId, error });
    return failure('integration_unavailable', requestId);
  }
  if (!counted.allowed) {
    return failure('rate_limited', requestId, undefined, {
      'retry-after': String(counted.retryAfter),
    });
  }

  if (!(await bodyIsEmpty(request))) return failure('validation_failed', requestId);

  const keys = await keysOrFailure(env, requestId);
  if (keys instanceof Response) return keys;

  let grant: RealtimeTokenGrant;
  try {
    grant = await deps.issue(principal, { requestId, client: clientMeta(request.headers) });
  } catch (error) {
    if (isDomainError(error) && error.code === 'forbidden') return failure('forbidden', requestId);
    logger.log('error', 'realtime.issue_failed', { requestId, error });
    return failure('internal', requestId);
  }

  try {
    const minted = await signRealtimeGrant(grant, keys, {
      issuer,
      now: (deps.now ?? (() => new Date()))(),
    });
    const body = RealtimeTokenResponse.parse({
      token: minted.token,
      expiresAt: minted.expiresAt.toISOString(),
      channels: realtimeChannels(minted.claims),
    });
    return Response.json(body, {
      headers: { 'cache-control': NO_STORE, 'x-request-id': requestId },
    });
  } catch (error) {
    logger.log('error', 'realtime.mint_failed', { requestId, error });
    return failure('internal', requestId);
  }
}

/** `GET /.well-known/jwks.json`: the public halves of the current and next keys. */
export async function jwksDocument(
  request: Pick<Request, 'headers'>,
  env: Env = process.env,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const keys = await keysOrFailure(env, requestId);
  if (keys instanceof Response) return keys;
  const body = JwksResponse.parse({ keys: publicKeyList(keys) });
  return Response.json(body, {
    headers: {
      'cache-control': `public, max-age=${String(JWKS_MAX_AGE_SECONDS)}`,
      'x-request-id': requestId,
    },
  });
}

/** `GET /.well-known/openid-configuration`: the issuer and where its key list lives. */
export function openIdConfigurationDocument(
  request: Pick<Request, 'headers'>,
  env: Env = process.env,
): Response {
  const requestId = incomingRequestId(request.headers);
  const issuer = bosIssuer(env);
  if (issuer === undefined) return failure('integration_unavailable', requestId);
  return Response.json(openIdConfiguration(issuer), {
    headers: {
      'cache-control': `public, max-age=${String(DISCOVERY_MAX_AGE_SECONDS)}`,
      'x-request-id': requestId,
    },
  });
}
