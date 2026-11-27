import {
  isStaffRole,
  type ErrorCode,
  type MobileAccessClaims,
  type Principal,
} from '@shakti/contracts';
import type { UserGrantRow } from '@shakti/db';
import { resolvePrincipalFromGrants, type KeyValue, type UserAccess } from '@shakti/domain';
import type { Env } from '../realtime/keys';
import { bosIssuer } from '../realtime/token';
import { addressKey, countRequest, type CapRule } from './request-cap';
import { clientAddress } from './client-address';
import type { DeviceStore } from './mobile-devices';
import { mobileKeys, type MobileKeys } from './mobile-keys';
import { bearerToken, verifyMobileAccessToken } from './mobile-tokens';
import { principalCache } from './principal-cache';

/**
 * The caller behind a field app's bearer token (docs/03-roadmap-appendix/phase4.md §6.4): the token
 * checked against the field app's key, the phone it names still signed in (checked on every call,
 * so a phone signed out from the web is refused at its next one), then the person resolved from
 * their grants exactly as a website session is (`resolvePrincipalFromGrants` over every company
 * they work in, cached for 60 seconds under the person's version counter). The route then runs
 * its query or command inside `withRequestContext()` with that principal, so row security applies
 * unchanged.
 */

/**
 * Calls one phone may make in a minute, and one address: the API's default of 600 a minute per
 * token (docs/06-api.md §1), and twice that per address, where a hub's phones share one.
 */
export const MOBILE_BEARER_CAPS = {
  perDevice: { window: 60, max: 600 },
  perAddress: { window: 60, max: 1200 },
} as const satisfies Record<string, CapRule>;

export interface BearerDeps {
  keyValue: KeyValue;
  devices: DeviceStore;
  grants: (userId: string) => Promise<UserGrantRow[]>;
  env?: Env;
  now?: () => Date;
}

export interface MobileCaller {
  principal: Principal;
  access: UserAccess;
  claims: MobileAccessClaims;
}

export interface Refusal {
  kind: 'refused';
  code: ErrorCode;
  reason?: string;
  headers?: Record<string, string>;
}

export const refuse = (
  code: ErrorCode,
  reason?: string,
  headers?: Record<string, string>,
): Refusal => ({
  kind: 'refused',
  code,
  ...(reason === undefined ? {} : { reason }),
  ...(headers === undefined ? {} : { headers }),
});

/** The keys and the issuer, or the refusal a route gives while the field app is not set up. */
export async function signingSetup(
  env: Env,
): Promise<{ keys: MobileKeys; issuer: string } | Refusal> {
  const issuer = bosIssuer(env);
  let keys: MobileKeys | undefined;
  try {
    keys = await mobileKeys(env);
  } catch {
    keys = undefined;
  }
  if (issuer === undefined || keys === undefined) return refuse('integration_unavailable');
  return { keys, issuer };
}

/**
 * The person as their grants resolve now, or why they may not act: a suspended person is refused,
 * and so is one whose role needs an authenticator app they have not set up (on the website).
 */
export async function resolveMobilePrincipal(
  userId: string,
  cacheSession: string,
  deps: Pick<BearerDeps, 'keyValue' | 'grants'>,
): Promise<{ principal: Principal; access: UserAccess } | Refusal> {
  const cache = principalCache(deps.keyValue);
  const key = await cache.keyFor(userId, cacheSession, undefined);
  const cached = await cache.read(key);
  if (cached) return cached;
  const outcome = resolvePrincipalFromGrants(userId, await deps.grants(userId));
  if (outcome.kind === 'inactive') return refuse('forbidden', 'account_suspended');
  if (outcome.kind === 'totp_required') return refuse('forbidden', 'totp_setup_required');
  if (outcome.kind !== 'principal') return refuse('forbidden');
  const { principal, access } = outcome;
  if (!isStaffRole(principal.roleKey) || principal.entityIds.length === 0) {
    return refuse('forbidden');
  }
  await cache.write(key, { principal, access });
  return { principal, access };
}

/** Counts one call against a cap; the refusal says how long to wait. */
export async function capped(
  keyValue: KeyValue,
  key: string,
  rule: CapRule,
): Promise<Refusal | undefined> {
  let counted: Awaited<ReturnType<typeof countRequest>>;
  try {
    counted = await countRequest(keyValue, key, rule);
  } catch {
    return refuse('integration_unavailable');
  }
  return counted.allowed
    ? undefined
    : refuse('rate_limited', undefined, { 'retry-after': String(counted.retryAfter) });
}

/** The caller of a bearer route, or why the call is refused. The token is never logged. */
export async function mobileCaller(
  request: Request,
  deps: BearerDeps,
): Promise<{ kind: 'ok'; caller: MobileCaller } | Refusal> {
  const env = deps.env ?? process.env;
  const token = bearerToken(request.headers);
  if (token === undefined) return refuse('unauthorized');
  const setup = await signingSetup(env);
  if ('kind' in setup) return setup;
  const now = (deps.now ?? (() => new Date()))();
  const claims = await verifyMobileAccessToken(token, setup.keys, setup.issuer, now);
  if (claims === undefined) return refuse('unauthorized');

  const standing = await deps.devices.standing(claims.sub, claims.sid);
  if (standing.kind === 'unknown') return refuse('unauthorized');
  // A token issued before the phone's current sign-in belongs to a family that has ended.
  if (
    standing.kind === 'revoked' ||
    claims.iat < Math.floor(standing.signedInAt.getTime() / 1000)
  ) {
    return refuse('unauthorized', 'device_revoked');
  }

  for (const [key, rule] of [
    [`mobile:device:${claims.sid}`, MOBILE_BEARER_CAPS.perDevice],
    [`mobile:address:${addressKey(clientAddress(request.headers))}`, MOBILE_BEARER_CAPS.perAddress],
  ] as const) {
    const over = await capped(deps.keyValue, key, rule);
    if (over !== undefined) return over;
  }

  const resolved = await resolveMobilePrincipal(claims.sub, `mobile:${claims.sid}`, deps);
  if ('kind' in resolved) return resolved;
  return { kind: 'ok', caller: { ...resolved, claims } };
}
