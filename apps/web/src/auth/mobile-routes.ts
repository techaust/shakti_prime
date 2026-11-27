import {
  MeResponse,
  type FeatureFlagKey,
  MobileRefreshRequest,
  MobileRevokeRequest,
  MobileRevokeResponse,
  MobileTokenRequest,
  MobileTokenResponse,
  type Principal,
  type StaffRoleKey,
} from '@shakti/contracts';
import type { UserGrantRow } from '@shakti/db';
import { loadUserGrants } from '@shakti/db/grants';
import { executeQuery, fieldAppProfile, type KeyValue, type Logger } from '@shakti/domain';
import { apiFailure } from '../api-failure';
import { logger as appLogger } from '../log';
import { tagSentryPrincipal } from '../observability/sentry-tag';
import type { Env } from '../realtime/keys';
import { declaredTooLarge, readTextWithin } from '../request-body';
import { incomingRequestId } from '../request-id';
import { recordAuthEvent } from './audit-events';
import { auth as appAuth } from './auth';
import { addressKey, type CapRule } from './request-cap';
import { clientAddress } from './client-address';
import type { Auth } from './create-auth';
import { defaultAuthDeps } from './deps';
import {
  capped,
  mobileCaller,
  refuse,
  resolveMobilePrincipal,
  signingSetup,
  type MobileCaller,
  type Refusal,
} from './mobile-bearer';
import { authDeviceStore, type DeviceStore } from './mobile-devices';
import type { MobileKeys } from './mobile-keys';
import { verifyMobileCredentials } from './mobile-sign-in';
import {
  MOBILE_REFRESH_SECONDS,
  newRefreshToken,
  nextRefreshToken,
  refreshTokenHash,
  signMobileAccessToken,
} from './mobile-tokens';
import { appVersionAccepted, fieldAppVersions } from './mobile-version';

/**
 * The field app's routes (docs/06-api.md §3.1, docs/03-roadmap-appendix/phase4.md §6.4):
 * `POST /auth/mobile/token`, `/refresh` and `/revoke`, and `GET /me`. Each refuses an app below the
 * minimum version first, then caps the caller, then reads anything. No token, password, code or
 * hash is ever logged: failures log the route's event and the error's own redacted fields only.
 */

/** The sign-in body: the device's push token may be 4 KiB, the rest is small. */
const TOKEN_BODY_MAX_BYTES = 8 * 1024;
const REFRESH_BODY_MAX_BYTES = 1024;
const EMPTY_BODY_MAX_BYTES = 64;

/**
 * Sign-ins one address may try in 15 minutes, and one account from anywhere: a hub's phones share
 * an address, and the account's own lock (five wrong passwords) still applies within them.
 * Refreshes: an app refreshes once per 15-minute token, so ten per phone leave room for retries.
 */
export const MOBILE_AUTH_CAPS = {
  tokenPerAddress: { window: 15 * 60, max: 30 },
  tokenPerAccount: { window: 15 * 60, max: 10 },
  refreshPerAddress: { window: 15 * 60, max: 120 },
  refreshPerDevice: { window: 15 * 60, max: 10 },
} as const satisfies Record<string, CapRule>;

export interface MobileRouteDeps {
  auth: Auth;
  keyValue: KeyValue;
  devices: DeviceStore;
  grants: (userId: string) => Promise<UserGrantRow[]>;
  /** The company codes and feature flags for `/me`, read under the caller's own policies. */
  profile: (principal: Principal) => Promise<{
    entityCodes: ReadonlyMap<number, string>;
    featureFlags: Record<FeatureFlagKey, boolean>;
  }>;
  logger: Logger;
  env?: Env;
  now?: () => Date;
}

export function defaultMobileDeps(): MobileRouteDeps {
  const deps = defaultAuthDeps();
  return {
    auth: appAuth,
    keyValue: deps.keyValue,
    devices: authDeviceStore,
    grants: loadUserGrants,
    profile: (principal) =>
      executeQuery(principal, { entityIds: principal.entityIds }, fieldAppProfile, {
        name: 'fieldAppProfile',
      }),
    logger: appLogger,
    now: deps.now,
  };
}

const NO_STORE = { 'cache-control': 'no-store' };

function answer(body: unknown, requestId: string): Response {
  return Response.json(body, { headers: { ...NO_STORE, 'x-request-id': requestId } });
}

function refused(r: Refusal, requestId: string): Response {
  return apiFailure(
    r.code,
    requestId,
    r.reason === undefined ? undefined : { reason: r.reason },
    r.headers,
  );
}

const updateRequired = (requestId: string) =>
  apiFailure('forbidden', requestId, { reason: 'app_update_required' });

/** The body as JSON within its cap, or undefined when it is too large or not JSON. */
async function jsonWithin(request: Request, maxBytes: number): Promise<unknown> {
  if (declaredTooLarge(request.headers, maxBytes)) return undefined;
  const text = await readTextWithin(request, maxBytes);
  if (text === undefined) return undefined;
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A new token pair for a phone whose person may act; the refresh hash is stored by `store`. */
async function issuePair(
  grant: { userId: string; deviceId: string; principal: Principal },
  setup: { keys: MobileKeys; issuer: string },
  now: Date,
  store: (refreshHash: string, expiresAt: Date) => Promise<void>,
): Promise<MobileTokenResponse> {
  const refreshToken = newRefreshToken();
  const refreshExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_SECONDS * 1000);
  await store(refreshTokenHash(refreshToken), refreshExpiresAt);
  const access = await signMobileAccessToken(
    {
      userId: grant.userId,
      deviceId: grant.deviceId,
      // resolveMobilePrincipal answers staff roles only.
      roleKey: grant.principal.roleKey as StaffRoleKey,
      entityIds: grant.principal.entityIds,
    },
    setup.keys,
    { issuer: setup.issuer, now },
  );
  return MobileTokenResponse.parse({
    tokenType: 'Bearer',
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    userId: grant.userId,
  });
}

/** Logs an unexpected failure of a route by its event, and answers `internal`. */
function failed(deps: MobileRouteDeps, event: string, requestId: string, error: unknown): Response {
  deps.logger.log('error', event, { requestId, error });
  return apiFailure('internal', requestId);
}

/** `POST /api/v1/auth/mobile/token`: email, password and the second factor → a token pair. */
export async function mobileTokenRoute(request: Request, deps: MobileRouteDeps): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const env = deps.env ?? process.env;
  const versions = fieldAppVersions(env);
  if (!appVersionAccepted(request.headers, versions.minimum)) return updateRequired(requestId);
  try {
    const address = addressKey(clientAddress(request.headers));
    const byAddress = await capped(
      deps.keyValue,
      `mobile-token:address:${address}`,
      MOBILE_AUTH_CAPS.tokenPerAddress,
    );
    if (byAddress !== undefined) return refused(byAddress, requestId);

    const parsed = MobileTokenRequest.safeParse(await jsonWithin(request, TOKEN_BODY_MAX_BYTES));
    if (!parsed.success) return apiFailure('validation_failed', requestId);
    const body = parsed.data;
    if (!appVersionAccepted(request.headers, versions.minimum, body.device.appVersion)) {
      return updateRequired(requestId);
    }
    const byAccount = await capped(
      deps.keyValue,
      `mobile-token:account:${body.email}`,
      MOBILE_AUTH_CAPS.tokenPerAccount,
    );
    if (byAccount !== undefined) return refused(byAccount, requestId);

    const setup = await signingSetup(env);
    if ('kind' in setup) return refused(setup, requestId);

    const checked = await verifyMobileCredentials(deps.auth, body, request.headers);
    if (checked.kind === 'refused') {
      const retry =
        checked.reason === 'account_locked' && checked.retryAfter !== undefined
          ? { 'retry-after': checked.retryAfter }
          : undefined;
      return refused(refuse('unauthorized', checked.reason, retry), requestId);
    }
    const resolved = await resolveMobilePrincipal(
      checked.userId,
      `mobile:${body.device.deviceId}`,
      deps,
    );
    if ('kind' in resolved) return refused(resolved, requestId);

    const now = (deps.now ?? (() => new Date()))();
    const pair = await issuePair(
      { userId: checked.userId, deviceId: body.device.deviceId, principal: resolved.principal },
      setup,
      now,
      async (refreshHash, expiresAt) => {
        await deps.devices.signIn({
          userId: checked.userId,
          device: body.device,
          refreshHash,
          expiresAt,
          now,
        });
      },
    );
    await recordAuthEvent(
      {
        event: 'auth.mobile.sign_in',
        outcome: 'ok',
        actorId: checked.userId,
        fields: { appVersion: body.device.appVersion },
        headers: request.headers,
      },
      deps.logger,
    );
    return answer(pair, requestId);
  } catch (error) {
    return failed(deps, 'mobile.token_failed', requestId, error);
  }
}

/** `POST /api/v1/auth/mobile/refresh`: the phone's refresh token → a new pair, both tokens new. */
export async function mobileRefreshRoute(
  request: Request,
  deps: MobileRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const env = deps.env ?? process.env;
  const versions = fieldAppVersions(env);
  if (!appVersionAccepted(request.headers, versions.minimum)) return updateRequired(requestId);
  try {
    const address = addressKey(clientAddress(request.headers));
    const byAddress = await capped(
      deps.keyValue,
      `mobile-refresh:address:${address}`,
      MOBILE_AUTH_CAPS.refreshPerAddress,
    );
    if (byAddress !== undefined) return refused(byAddress, requestId);

    const parsed = MobileRefreshRequest.safeParse(
      await jsonWithin(request, REFRESH_BODY_MAX_BYTES),
    );
    if (!parsed.success) return apiFailure('validation_failed', requestId);
    const body = parsed.data;
    if (!appVersionAccepted(request.headers, versions.minimum, body.appVersion)) {
      return updateRequired(requestId);
    }
    const byDevice = await capped(
      deps.keyValue,
      `mobile-refresh:device:${body.deviceId}`,
      MOBILE_AUTH_CAPS.refreshPerDevice,
    );
    if (byDevice !== undefined) return refused(byDevice, requestId);

    const setup = await signingSetup(env);
    if ('kind' in setup) return refused(setup, requestId);

    const now = (deps.now ?? (() => new Date()))();
    // Derived from the presented token, so a retry of a lost answer gets the same one again.
    const refreshToken = nextRefreshToken(body.refreshToken, setup.keys);
    let refreshExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_SECONDS * 1000);
    const outcome = await deps.devices.rotate({
      deviceId: body.deviceId,
      presentedHash: refreshTokenHash(body.refreshToken),
      newHash: refreshTokenHash(refreshToken),
      expiresAt: refreshExpiresAt,
      appVersion: body.appVersion,
      now,
    });
    if (outcome.kind === 'reused') {
      await recordAuthEvent(
        {
          event: 'auth.mobile.refresh_reused',
          outcome: 'denied',
          actorId: outcome.userId,
          headers: request.headers,
        },
        deps.logger,
      );
      return refused(refuse('unauthorized', 'refresh_reused'), requestId);
    }
    if (outcome.kind === 'revoked')
      return refused(refuse('unauthorized', 'device_revoked'), requestId);
    if (outcome.kind === 'retried') refreshExpiresAt = outcome.expiresAt;
    else if (outcome.kind !== 'rotated') {
      return refused(refuse('unauthorized', 'refresh_expired'), requestId);
    }

    const resolved = await resolveMobilePrincipal(
      outcome.userId,
      `mobile:${outcome.deviceId}`,
      deps,
    );
    if ('kind' in resolved) {
      // A person who may no longer act keeps no phone signed in; they sign in again once they may.
      await deps.devices.signOut(outcome.userId, outcome.deviceId, 'signed_out', now);
      return refused(resolved, requestId);
    }
    const access = await signMobileAccessToken(
      {
        userId: outcome.userId,
        deviceId: outcome.deviceId,
        roleKey: resolved.principal.roleKey as StaffRoleKey,
        entityIds: resolved.principal.entityIds,
      },
      setup.keys,
      { issuer: setup.issuer, now },
    );
    return answer(
      MobileTokenResponse.parse({
        tokenType: 'Bearer',
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        refreshToken,
        refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
        userId: outcome.userId,
      }),
      requestId,
    );
  } catch (error) {
    return failed(deps, 'mobile.refresh_failed', requestId, error);
  }
}

/**
 * The bearer routes' shared front: the version gate, then the caller. `run` gets the caller and
 * answers the route's body; the person is tagged on this request's Sentry events by id only.
 */
async function withCaller(
  request: Request,
  deps: MobileRouteDeps,
  event: string,
  run: (caller: MobileCaller, requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const env = deps.env ?? process.env;
  if (!appVersionAccepted(request.headers, fieldAppVersions(env).minimum)) {
    return updateRequired(requestId);
  }
  try {
    const found = await mobileCaller(request, {
      keyValue: deps.keyValue,
      devices: deps.devices,
      grants: deps.grants,
      env,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });
    if (found.kind === 'refused') return refused(found, requestId);
    await tagSentryPrincipal(found.caller.principal.id);
    return await run(found.caller, requestId);
  } catch (error) {
    return failed(deps, event, requestId, error);
  }
}

/** `POST /api/v1/auth/mobile/revoke`: signs this phone out. */
export function mobileRevokeRoute(request: Request, deps: MobileRouteDeps): Promise<Response> {
  return withCaller(request, deps, 'mobile.revoke_failed', async (caller, requestId) => {
    if (!MobileRevokeRequest.safeParse(await jsonWithin(request, EMPTY_BODY_MAX_BYTES)).success) {
      return apiFailure('validation_failed', requestId);
    }
    const now = (deps.now ?? (() => new Date()))();
    await deps.devices.signOut(caller.claims.sub, caller.claims.sid, 'signed_out', now);
    await recordAuthEvent(
      {
        event: 'auth.mobile.sign_out',
        outcome: 'ok',
        actorId: caller.claims.sub,
        headers: request.headers,
      },
      deps.logger,
    );
    return answer(
      MobileRevokeResponse.parse({ revoked: true, deviceId: caller.claims.sid }),
      requestId,
    );
  });
}

/** `GET /api/v1/me`: the person, their roles and grants, the flags and the app's versions. */
export function meRoute(request: Request, deps: MobileRouteDeps): Promise<Response> {
  return withCaller(request, deps, 'mobile.me_failed', async ({ principal, access }, requestId) => {
    const env = deps.env ?? process.env;
    const versions = fieldAppVersions(env);
    const profile = await deps.profile(principal);
    const now = (deps.now ?? (() => new Date()))();
    const body = MeResponse.parse({
      principal: {
        id: principal.id,
        kind: principal.kind,
        name: access.name,
        email: access.email,
        theme: access.theme,
      },
      roles: access.entities
        .filter((e) => principal.entityIds.includes(e.entityId))
        .map((e) => ({
          entityId: e.entityId,
          entityCode: profile.entityCodes.get(e.entityId),
          roleKey: e.roleKey,
          teamId: e.teamId,
        })),
      permissions: principal.permissions,
      featureFlags: profile.featureFlags,
      minimumAppVersion: versions.minimum,
      latestAppVersion: versions.latest,
      serverTime: now.toISOString(),
    });
    return answer(body, requestId);
  });
}
