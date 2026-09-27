import {
  ERROR_HTTP_STATUS,
  ErrorEnvelope,
  isAgentRole,
  isDomainError,
  newId,
  type ErrorCode,
  type Principal,
} from '@shakti/contracts';
import en from '../../messages/en.json';
import { logger } from '../log';
import { JwksResponse, RealtimeTokenResponse, realtimeChannels } from './claims';
import { publicKeyList, signingKeys, SigningKeyError, type Env, type SigningKeys } from './keys';
import { bosIssuer, mintRealtimeToken, openIdConfiguration } from './token';

/**
 * How long a relying party may keep the key list. A rotation waits longer than this between
 * publishing the next key and signing with it (docs/runbooks/DEPLOY.md).
 */
export const JWKS_MAX_AGE_SECONDS = 300;
const DISCOVERY_MAX_AGE_SECONDS = 3600;

const NO_STORE = 'no-store';

function failure(code: ErrorCode, requestId: string, details?: { reason: string }): Response {
  const catalogue: Readonly<Record<string, string>> = en.errors;
  // A reason with its own sentence reads better than the code's general one (the one catalogue is
  // English, ADR 0014, and a route handler has no request locale to resolve).
  const message = (details && catalogue[details.reason]) ?? catalogue[code] ?? en.errors.internal;
  const body = ErrorEnvelope.parse({
    error: { code, message, requestId, ...(details === undefined ? {} : { details }) },
  });
  return Response.json(body, {
    status: ERROR_HTTP_STATUS[code],
    headers: { 'cache-control': NO_STORE, 'x-request-id': requestId },
  });
}

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

export interface TokenRouteDeps {
  /** The signed-in caller; undefined without a session. May throw `unauthorized` (`totp_required`). */
  principal: () => Promise<Principal | undefined>;
  env?: Env;
  now?: () => Date;
}

/**
 * `POST /api/v1/realtime/token` (docs/API.md §3.1): a Realtime token for the signed-in person.
 * A call from another site is refused even with the cookie: the token is only for the BOS's own
 * screens.
 */
export async function issueRealtimeToken(
  request: Request,
  deps: TokenRouteDeps,
): Promise<Response> {
  const requestId = newId();
  const env = deps.env ?? process.env;
  const issuer = bosIssuer(env);
  if (issuer === undefined) {
    logger.log('error', 'realtime.issuer_missing', { requestId });
    return failure('integration_unavailable', requestId);
  }
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== issuer) return failure('forbidden', requestId);

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
    isAgentRole(principal.roleKey) ||
    principal.entityIds.length === 0
  ) {
    return failure('forbidden', requestId);
  }

  const keys = await keysOrFailure(env, requestId);
  if (keys instanceof Response) return keys;

  try {
    const minted = await mintRealtimeToken(principal, keys, {
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
export async function jwksDocument(env: Env = process.env): Promise<Response> {
  const requestId = newId();
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
export function openIdConfigurationDocument(env: Env = process.env): Response {
  const requestId = newId();
  const issuer = bosIssuer(env);
  if (issuer === undefined) return failure('integration_unavailable', requestId);
  return Response.json(openIdConfiguration(issuer), {
    headers: {
      'cache-control': `public, max-age=${String(DISCOVERY_MAX_AGE_SECONDS)}`,
      'x-request-id': requestId,
    },
  });
}
