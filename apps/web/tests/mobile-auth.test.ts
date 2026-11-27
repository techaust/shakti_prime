import {
  ErrorEnvelope,
  MeResponse,
  MobileRevokeResponse,
  MobileTokenResponse,
  newId,
  type Principal,
} from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { loadUserGrants } from '@shakti/db/grants';
import { asMigrator, closeDb, createTestPrincipal, createTestUser } from '@shakti/db/testing';
import {
  executeCommand,
  executeQuery,
  fieldAppProfile,
  listEntities,
  memoryKeyValue,
  memoryLogger,
  memoryMailer,
  revokeMobileDevice,
  setFeatureFlag,
  suspendUser,
} from '@shakti/domain';
import { sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth, type Auth } from '../src/auth/create-auth';
import { mobileCaller } from '../src/auth/mobile-bearer';
import { authDeviceStore } from '../src/auth/mobile-devices';
import {
  meRoute,
  MOBILE_AUTH_CAPS,
  mobileRefreshRoute,
  mobileRevokeRoute,
  mobileTokenRoute,
  type MobileRouteDeps,
} from '../src/auth/mobile-routes';
import { refreshTokenHash } from '../src/auth/mobile-tokens';
import {
  invalidatePrincipal,
  requirePrincipal,
  resolveSessionPrincipal,
} from '../src/auth/session-principal';
import { TURNSTILE_HEADER } from '../src/auth/turnstile';
import { scrubEvent } from '../src/observability/sentry-scrub';
import type { Env } from '../src/realtime/keys';

// The field app's sign-in on real Postgres (auth_service and app_user), through the app's one
// Better Auth instance, with in-memory Redis and mail and stubbed Turnstile and breached-password
// services (docs/03-roadmap-appendix/phase4.md §6.4, §13: rotation, reuse, revocation, expiry,
// rate limits, no token in a log or a Sentry event, and row security under a mobile bearer equal
// to a session's). The key pair is made at test time; nothing leaves the machine.

const ISSUER = 'http://localhost:3000';
// Long enough for Better Auth, low-entropy so the secret scan does not mistake it for a key.
const TEST_AUTH_SECRET = 'test-only-secret-test-only-secret-test-only-secret';
const PASSWORD = 'monsoon pump 2026 river';
const APP = '1.0.0';

let clock = new Date();
const keyValue = memoryKeyValue(() => clock.getTime());
const mailer = memoryMailer();
const logger = memoryLogger();
const authLogger = memoryLogger();
const fetchStub = vi.fn((input: RequestInfo | URL): Promise<Response> => {
  const url = input instanceof Request ? input.url : input.toString();
  if (url.includes('turnstile')) {
    return Promise.resolve(
      Response.json({ success: true, hostname: 'localhost', action: 'sign-in' }),
    );
  }
  if (url.includes('pwnedpasswords')) return Promise.resolve(new Response('', { status: 200 }));
  return Promise.reject(new Error(`unexpected fetch ${url}`));
});

let auth: Auth;
let env: Env;
/** Every token the routes handed out, to look for in the logs, the audit trail and Sentry. */
const issued: string[] = [];

function deps(overrides: Partial<MobileRouteDeps> = {}): MobileRouteDeps {
  return {
    auth,
    keyValue,
    devices: authDeviceStore,
    grants: loadUserGrants,
    profile: (principal) =>
      executeQuery(principal, { entityIds: principal.entityIds }, fieldAppProfile, {
        name: 'fieldAppProfile',
      }),
    logger,
    env,
    now: () => clock,
    ...overrides,
  };
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  auth = createAuth(
    {
      keyValue,
      mailer,
      fetch: fetchStub,
      now: () => clock,
      turnstileSecretKey: 'secret',
      logger: authLogger,
    },
    { nextCookies: false, baseURL: ISSUER, secret: TEST_AUTH_SECRET },
  );
  const { exportJWK, generateKeyPair } = await import('jose');
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  env = {
    BETTER_AUTH_URL: ISSUER,
    MOBILE_JWT_PRIVATE_KEY: JSON.stringify(jwk),
    MOBILE_JWT_PUBLIC_KEY: JSON.stringify(publicJwk),
  };
});
afterAll(async () => {
  await closeAuthDb();
  vi.unstubAllGlobals();
  await closeDb();
});

let address = 0;
/** A fresh address per test, so one test's caps never reach another's. */
const nextAddress = () =>
  `10.7.${String(Math.floor(address / 250))}.${String((address++ % 250) + 1)}`;

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .join('; ');
}

async function person(entityRoles: Parameters<typeof createTestUser>[0]) {
  const user = await createTestUser(entityRoles, { status: 'invited' });
  await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: '/set-password' } });
  const token = /reset-password\/([^?\s]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1];
  if (token === undefined) throw new Error('no set-password link in the mail');
  await auth.api.resetPassword({
    body: { newPassword: PASSWORD, token },
    headers: new Headers({ 'x-forwarded-for': '10.6.0.1' }),
  });
  return user;
}

/** RFC 6238 with the defaults Better Auth uses (SHA-1, 30 s, 6 digits). */
function totpCode(secretBase32: string, at: Date): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.toUpperCase().replaceAll('=', '')) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / 30)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0xf;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

/** An Executive with an authenticator app; answers the secret for making codes. */
async function enrolledExecutive() {
  const user = await person([{ entityId: 1, roleKey: 'executive' }]);
  const web = new Headers({ [TURNSTILE_HEADER]: 'ok', 'x-forwarded-for': '10.6.0.2' });
  const first = await auth.api.signInEmail({
    body: { email: user.email, password: PASSWORD },
    headers: web,
    returnHeaders: true,
  });
  web.set('cookie', cookieHeader(first.headers));
  const enrol = await auth.api.enableTwoFactor({
    body: { password: PASSWORD, method: 'totp' },
    headers: web,
  });
  if (enrol.method !== 'totp') throw new Error('expected a totp enrolment');
  const secret = new URL(enrol.totpURI).searchParams.get('secret') ?? '';
  const intoStep = Date.now() % 30_000;
  if (intoStep > 27_000) await new Promise((done) => setTimeout(done, 30_100 - intoStep));
  await auth.api.verifyTOTP({
    body: { code: totpCode(secret, new Date(Date.now() - 30_000)) },
    headers: web,
  });
  return { user, secret };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ISSUER}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-version': APP,
      'x-forwarded-for': nextAddress(),
      'user-agent': 'ShaktiField/1.0.0 (Android 14)',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function device(deviceId = newId()) {
  return { deviceId, platform: 'android', model: 'Galaxy M14', osVersion: '14', appVersion: APP };
}

async function signIn(
  email: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return mobileTokenRoute(
    post('/auth/mobile/token', { email, password: PASSWORD, device: device(), ...extra }, headers),
    deps(),
  );
}

async function pair(response: Response): Promise<MobileTokenResponse> {
  expect(response.status).toBe(200);
  const body = MobileTokenResponse.parse(await response.json());
  issued.push(body.accessToken, body.refreshToken);
  return body;
}

async function reasonOf(
  response: Response,
): Promise<{ status: number; code: string; reason: unknown }> {
  const body = ErrorEnvelope.parse(await response.json());
  return { status: response.status, code: body.error.code, reason: body.error.details?.reason };
}

const refresh = (refreshToken: string, deviceId: string, headers: Record<string, string> = {}) =>
  mobileRefreshRoute(
    post('/auth/mobile/refresh', { refreshToken, deviceId, appVersion: APP }, headers),
    deps(),
  );

const bearer = (accessToken: string, headers: Record<string, string> = {}) => ({
  authorization: `Bearer ${accessToken}`,
  ...headers,
});

const me = (accessToken: string, headers: Record<string, string> = {}) =>
  meRoute(
    new Request(`${ISSUER}/api/v1/me`, {
      headers: {
        'x-app-version': APP,
        'x-forwarded-for': nextAddress(),
        ...bearer(accessToken, headers),
      },
    }),
    deps(),
  );

/** Signs a field engineer in on a new phone; answers the person, the phone and the pair. */
async function engineerOnPhone(
  entityRoles: Parameters<typeof createTestUser>[0] = [{ entityId: 1, roleKey: 'field_engineer' }],
) {
  const user = await person(entityRoles);
  const phone = device();
  const tokens = await pair(
    await mobileTokenRoute(
      post('/auth/mobile/token', { email: user.email, password: PASSWORD, device: phone }),
      deps(),
    ),
  );
  return { user, phone, tokens };
}

async function phoneRow(userId: string, deviceId: string) {
  const [row] = await asMigrator(
    (m) => m<
      { id: string; hash: string; revoked_at: Date | null; revoked_reason: string | null }[]
    >`
      select id, refresh_token_hash as hash, revoked_at, revoked_reason
        from mobile_devices where user_id = ${userId} and device_id = ${deviceId}`,
  );
  return row;
}

describe('POST /auth/mobile/token', () => {
  it('signs a field engineer in with the phone bound to the pair, and keeps only the hash', async () => {
    const { user, phone, tokens } = await engineerOnPhone();
    expect(tokens).toMatchObject({ tokenType: 'Bearer', userId: user.id });
    const accessLife = Date.parse(tokens.accessTokenExpiresAt) - clock.getTime();
    expect(accessLife).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(accessLife).toBeGreaterThan(14 * 60 * 1000);
    const row = await phoneRow(user.id, phone.deviceId);
    expect(row?.hash).toBe(refreshTokenHash(tokens.refreshToken));
    expect(row?.hash).not.toContain(tokens.refreshToken);
    // Better Auth's website session made on the way is gone: the phone holds no cookie.
    const [sessions] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from sessions where user_id = ${user.id}`,
    );
    expect(sessions?.n).toBe(0);
    const [event] = await asMigrator(
      (m) => m<{ input_json: Record<string, unknown> }[]>`
        select input_json from audit_logs
         where actor_principal_id = ${user.id} and command = 'auth.mobile.sign_in'`,
    );
    expect(event?.input_json).toEqual({ appVersion: APP });
  });

  it('refuses a wrong password, and the same as for an address with no account', async () => {
    const user = await person([{ entityId: 1, roleKey: 'field_engineer' }]);
    expect(await reasonOf(await signIn(user.email, { password: 'wrong password here' }))).toEqual({
      status: 401,
      code: 'unauthorized',
      reason: 'invalid_credentials',
    });
    expect(await reasonOf(await signIn(`nobody-${newId().slice(-8)}@shakti.test`))).toMatchObject({
      reason: 'invalid_credentials',
    });
  });

  it('asks an Executive for the authenticator code, refuses a wrong one, and takes the right one', async () => {
    const { user, secret } = await enrolledExecutive();
    expect(await reasonOf(await signIn(user.email))).toMatchObject({
      status: 401,
      reason: 'totp_required',
    });
    expect(await reasonOf(await signIn(user.email, { totpCode: '000000' }))).toMatchObject({
      status: 401,
      reason: 'totp_invalid',
    });
    const tokens = await pair(await signIn(user.email, { totpCode: totpCode(secret, new Date()) }));
    expect(tokens.userId).toBe(user.id);
  });

  it('refuses a role that needs an authenticator app not set up yet', async () => {
    const user = await person([{ entityId: 1, roleKey: 'general_manager' }]);
    expect(await reasonOf(await signIn(user.email))).toEqual({
      status: 403,
      code: 'forbidden',
      reason: 'totp_setup_required',
    });
  });

  it('refuses an app below the minimum version, in the header or the body, before anything else', async () => {
    const user = await person([{ entityId: 1, roleKey: 'field_engineer' }]);
    for (const headers of [{ 'x-app-version': '0.9.9' }, { 'x-app-version': 'old' }]) {
      expect(await reasonOf(await signIn(user.email, {}, headers))).toEqual({
        status: 403,
        code: 'forbidden',
        reason: 'app_update_required',
      });
    }
    const old = { ...device(), appVersion: '0.9.0' };
    expect(await reasonOf(await signIn(user.email, { device: old }))).toMatchObject({
      reason: 'app_update_required',
    });
    const raised = deps({ env: { ...env, FIELD_MIN_APP_VERSION: '1.1.0' } });
    const refused = await mobileTokenRoute(
      post('/auth/mobile/token', { email: user.email, password: PASSWORD, device: device() }),
      raised,
    );
    expect(await reasonOf(refused)).toMatchObject({ reason: 'app_update_required' });
  });

  it('caps sign-ins per account and per address', async () => {
    const user = await person([{ entityId: 1, roleKey: 'field_engineer' }]);
    let last: Response | undefined;
    for (let i = 0; i <= MOBILE_AUTH_CAPS.tokenPerAccount.max; i += 1) {
      last = await signIn(user.email, { password: 'wrong password here' });
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBe(String(MOBILE_AUTH_CAPS.tokenPerAccount.window));

    const shared = { 'x-forwarded-for': '10.8.8.8' };
    let fromHub: Response | undefined;
    for (let i = 0; i <= MOBILE_AUTH_CAPS.tokenPerAddress.max; i += 1) {
      fromHub = await signIn(`nobody-${String(i)}-${newId().slice(-6)}@shakti.test`, {}, shared);
    }
    expect(fromHub?.status).toBe(429);
  });

  it('answers unavailable while the field app has no key pair here', async () => {
    const user = await person([{ entityId: 1, roleKey: 'field_engineer' }]);
    const response = await mobileTokenRoute(
      post('/auth/mobile/token', { email: user.email, password: PASSWORD, device: device() }),
      deps({ env: { BETTER_AUTH_URL: ISSUER } }),
    );
    expect(await reasonOf(response)).toMatchObject({
      status: 503,
      code: 'integration_unavailable',
    });
  });
});

describe('POST /auth/mobile/refresh', () => {
  it('rotates both tokens, and a rotated token presented again ends the family', async () => {
    const { user, phone, tokens } = await engineerOnPhone();
    const second = await pair(await refresh(tokens.refreshToken, phone.deviceId));
    expect(second.refreshToken).not.toBe(tokens.refreshToken);
    expect(second.accessToken).not.toBe(tokens.accessToken);
    expect((await me(second.accessToken)).status).toBe(200);

    expect(await reasonOf(await refresh(tokens.refreshToken, phone.deviceId))).toEqual({
      status: 401,
      code: 'unauthorized',
      reason: 'refresh_reused',
    });
    expect(await phoneRow(user.id, phone.deviceId)).toMatchObject({
      revoked_reason: 'refresh_reused',
    });
    // Every token of the family is dead: the refresh token and the access token alike.
    expect(await reasonOf(await refresh(second.refreshToken, phone.deviceId))).toMatchObject({
      reason: 'device_revoked',
    });
    expect(await reasonOf(await me(second.accessToken))).toMatchObject({
      reason: 'device_revoked',
    });
    const [event] = await asMigrator(
      (m) => m<{ outcome: string }[]>`select outcome from audit_logs
         where actor_principal_id = ${user.id} and command = 'auth.mobile.refresh_reused'`,
    );
    expect(event?.outcome).toBe('denied');
  });

  it('gives a new pair to only one of two refreshes sent at once with the same token', async () => {
    const { phone, tokens } = await engineerOnPhone();
    const answers = await Promise.all([
      refresh(tokens.refreshToken, phone.deviceId),
      refresh(tokens.refreshToken, phone.deviceId),
    ]);
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses).toEqual([200, 401]);
    const won = answers.find((a) => a.status === 200);
    const lost = answers.find((a) => a.status === 401);
    if (won === undefined || lost === undefined) throw new Error('expected one of each');
    expect(await reasonOf(lost)).toMatchObject({ reason: 'refresh_reused' });
    // The winner's pair belongs to the ended family too: the person signs in again.
    const winner = await pair(won);
    expect(await reasonOf(await refresh(winner.refreshToken, phone.deviceId))).toMatchObject({
      reason: 'device_revoked',
    });
  });

  it('refuses a live token sent with another installation’s id, and ends its family', async () => {
    const { user, phone, tokens } = await engineerOnPhone();
    expect(await reasonOf(await refresh(tokens.refreshToken, newId()))).toMatchObject({
      reason: 'refresh_reused',
    });
    expect(await phoneRow(user.id, phone.deviceId)).toMatchObject({
      revoked_reason: 'refresh_reused',
    });
  });

  it('refuses a refresh token past its 30 days, and an access token past its 15 minutes', async () => {
    const { phone, tokens } = await engineerOnPhone();
    const start = clock;
    try {
      clock = new Date(start.getTime() + 16 * 60 * 1000);
      expect(await reasonOf(await me(tokens.accessToken))).toEqual({
        status: 401,
        code: 'unauthorized',
        reason: undefined,
      });
      clock = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000 + 1000);
      expect(await reasonOf(await refresh(tokens.refreshToken, phone.deviceId))).toMatchObject({
        reason: 'refresh_expired',
      });
    } finally {
      clock = start;
    }
  });

  it('caps refreshes per phone', async () => {
    const { phone } = await engineerOnPhone();
    let last: Response | undefined;
    for (let i = 0; i <= MOBILE_AUTH_CAPS.refreshPerDevice.max; i += 1) {
      last = await refresh('A'.repeat(43), phone.deviceId);
    }
    expect(last?.status).toBe(429);
  });
});

describe('a phone signed out', () => {
  it('from the web is refused at its next call, access token and refresh alike', async () => {
    const { user, phone, tokens } = await engineerOnPhone();
    const row = await phoneRow(user.id, phone.deviceId);
    const exec = await createTestPrincipal('executive');
    await executeCommand(exec, { entityIds: exec.entityIds }, revokeMobileDevice, { id: row?.id });
    expect(await reasonOf(await me(tokens.accessToken))).toEqual({
      status: 401,
      code: 'unauthorized',
      reason: 'device_revoked',
    });
    expect(await reasonOf(await refresh(tokens.refreshToken, phone.deviceId))).toMatchObject({
      reason: 'device_revoked',
    });
  });

  it('by the app itself ends its tokens; a new sign-in on the phone starts a new family', async () => {
    const { user, phone, tokens } = await engineerOnPhone();
    const out = await mobileRevokeRoute(
      post('/auth/mobile/revoke', {}, bearer(tokens.accessToken)),
      deps(),
    );
    expect(MobileRevokeResponse.parse(await out.json())).toEqual({
      revoked: true,
      deviceId: phone.deviceId,
    });
    expect(await reasonOf(await me(tokens.accessToken))).toMatchObject({
      reason: 'device_revoked',
    });
    // A moment later the person signs in on the same phone again.
    clock = new Date(clock.getTime() + 5000);
    const again = await pair(
      await mobileTokenRoute(
        post('/auth/mobile/token', { email: user.email, password: PASSWORD, device: phone }),
        deps(),
      ),
    );
    expect((await me(again.accessToken)).status).toBe(200);
    // The access token of the ended family stays refused on the phone signed in again.
    expect(await reasonOf(await me(tokens.accessToken))).toMatchObject({
      reason: 'device_revoked',
    });
  });

  it('by another person signing in on the same installation', async () => {
    const first = await engineerOnPhone();
    const other = await person([{ entityId: 1, roleKey: 'field_engineer' }]);
    await pair(
      await mobileTokenRoute(
        post('/auth/mobile/token', { email: other.email, password: PASSWORD, device: first.phone }),
        deps(),
      ),
    );
    expect(await reasonOf(await me(first.tokens.accessToken))).toMatchObject({
      reason: 'device_revoked',
    });
  });

  it('a suspended person is refused at the next call', async () => {
    const { user, tokens } = await engineerOnPhone();
    const exec = await createTestPrincipal('executive');
    await executeCommand(exec, { entityIds: exec.entityIds }, suspendUser, { userId: user.id });
    await invalidatePrincipal(keyValue, user.id);
    expect(await reasonOf(await me(tokens.accessToken))).toEqual({
      status: 403,
      code: 'forbidden',
      reason: 'account_suspended',
    });
  });
});

describe('GET /me', () => {
  it('answers the person, their roles and grants, the flags and the versions', async () => {
    const { user, tokens } = await engineerOnPhone([
      { entityId: 1, roleKey: 'field_engineer' },
      { entityId: 3, roleKey: 'field_engineer' },
    ]);
    const exec = await createTestPrincipal('executive');
    const key = `field.test_${newId().slice(-8).replaceAll('-', '')}`;
    await executeCommand(exec, { entityIds: exec.entityIds }, setFeatureFlag, {
      key,
      entityId: 3,
      enabled: true,
    });
    const response = await me(tokens.accessToken);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = MeResponse.parse(await response.json());
    expect(body.principal).toMatchObject({ id: user.id, kind: 'user', email: user.email });
    expect(body.roles.map((r) => [r.entityId, r.roleKey])).toEqual([
      [1, 'field_engineer'],
      [3, 'field_engineer'],
    ]);
    expect(body.roles.every((r) => /^[A-Z0-9]{2,10}$/.test(r.entityCode))).toBe(true);
    expect(body.featureFlags[key]).toBe(true);
    expect(body).toMatchObject({ minimumAppVersion: '1.0.0', latestAppVersion: '1.0.0' });
  });

  it('refuses a call with no bearer, a forged one, or an old app', async () => {
    const { tokens } = await engineerOnPhone();
    expect((await me('')).status).toBe(401);
    const [head, payload] = tokens.accessToken.split('.');
    expect((await me(`${head ?? ''}.${payload ?? ''}.${'A'.repeat(86)}`)).status).toBe(401);
    expect(
      await reasonOf(await me(tokens.accessToken, { 'x-app-version': '0.1.0' })),
    ).toMatchObject({
      reason: 'app_update_required',
    });
  });
});

describe('row security under a mobile bearer', () => {
  it('is the same as under a website session of the same person', async () => {
    const { user, tokens } = await engineerOnPhone([
      { entityId: 1, roleKey: 'field_engineer' },
      { entityId: 2, roleKey: 'store_manager' },
    ]);
    const found = await mobileCaller(
      new Request(`${ISSUER}/api/v1/me`, { headers: bearer(tokens.accessToken) }),
      { keyValue, devices: authDeviceStore, grants: loadUserGrants, env, now: () => clock },
    );
    if (found.kind !== 'ok') throw new Error('the bearer was refused');
    const web = new Headers({ [TURNSTILE_HEADER]: 'ok', 'x-forwarded-for': '10.6.0.3' });
    const signedIn = await auth.api.signInEmail({
      body: { email: user.email, password: PASSWORD },
      headers: web,
      returnHeaders: true,
    });
    web.set('cookie', cookieHeader(signedIn.headers));
    const session = requirePrincipal(
      await resolveSessionPrincipal(web, undefined, {
        auth,
        keyValue: memoryKeyValue(),
        now: () => clock,
      }),
    );
    if (session === undefined) throw new Error('the session resolved to no one');
    expect(found.caller.principal).toEqual(session);

    // The same rows under either: the companies, and the leads their policies let them see.
    const companies = (principal: Principal) =>
      executeQuery(principal, { entityIds: principal.entityIds }, listEntities, {
        name: 'listEntities',
      });
    const leads = (principal: Principal) =>
      executeQuery(
        principal,
        { entityIds: principal.entityIds },
        ({ tx }) => tx.execute(sql`select id from opportunities order by id`),
        { name: 'visibleLeads' },
      );
    expect(await companies(found.caller.principal)).toEqual(await companies(session));
    expect(await leads(found.caller.principal)).toEqual(await leads(session));
  });
});

describe('no token reaches a log, the audit trail or Sentry', () => {
  it('holds for every pair issued in this file', async () => {
    expect(issued.length).toBeGreaterThan(10);
    const logs = JSON.stringify([logger.entries, authLogger.entries]);
    const audit = await asMigrator(
      (m) => m<{ text: string }[]>`
        select coalesce(input_json::text, '') || coalesce(before_json::text, '') ||
               coalesce(after_json::text, '') as text
          from audit_logs where command like 'auth.%' or command like 'field.%'
         order by created_at desc limit 2000`,
    );
    const trail = audit.map((r) => r.text).join('\n');
    for (const token of issued) {
      expect(logs).not.toContain(token);
      expect(trail).not.toContain(token);
    }
  });

  it('drops a bearer, a token field and a token in text from a Sentry event', () => {
    const access = issued[0] ?? '';
    const refreshToken = issued[1] ?? '';
    const event = scrubEvent({
      message: `refresh failed with Bearer ${access}, then ${access} alone`,
      request: {
        method: 'POST',
        url: `${ISSUER}/api/v1/auth/mobile/refresh?token=${refreshToken}`,
        headers: { authorization: `Bearer ${access}` },
        data: JSON.stringify({ refreshToken }),
      },
      extra: { refreshToken, accessToken: access, body: { refreshToken } },
      breadcrumbs: [{ message: `token ${access}`, data: { authorization: `Bearer ${access}` } }],
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(access);
    expect(text).not.toContain(refreshToken);
  });
});
