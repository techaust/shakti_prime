import { ErrorEnvelope } from '@shakti/contracts';
import { closeDb, createTestUser } from '@shakti/db/testing';
import { memoryKeyValue, memoryMailer } from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth, type Auth } from '../src/auth/create-auth';
import { requirePrincipal, resolveSessionPrincipal } from '../src/auth/session-principal';
import { TURNSTILE_HEADER } from '../src/auth/turnstile';
import { JwksResponse, RealtimeTokenResponse } from '../src/realtime/claims';
import { issueRealtimeToken, jwksDocument } from '../src/realtime/handlers';
import type { Env } from '../src/realtime/keys';
import { newSigningKeyJson } from '../src/realtime/test-keys';
import { verifyRealtimeToken } from '../src/realtime/token';

// A real session on real Postgres (auth_service and app_user), resolved the way currentPrincipal()
// resolves it, handed to the token route. Keys are made at test time; nothing leaves the machine.

const ISSUER = 'http://localhost:3000';
// Low-entropy so the secret scan does not mistake it for a key (CLAUDE.md).
const TEST_AUTH_SECRET = 'test-only-secret-test-only-secret-test-only-secret';
const PASSWORD = 'monsoon pump 2026 river';

const clock = new Date('2026-09-27T10:00:00Z');
const keyValue = memoryKeyValue(() => clock.getTime());
const mailer = memoryMailer();
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

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  auth = createAuth(
    { keyValue, mailer, fetch: fetchStub, now: () => clock, turnstileSecretKey: 'secret' },
    { nextCookies: false, baseURL: ISSUER, secret: TEST_AUTH_SECRET },
  );
  env = {
    BETTER_AUTH_URL: ISSUER,
    BOS_JWT_CURRENT_KEY: await newSigningKeyJson(),
    BOS_JWT_NEXT_KEY: await newSigningKeyJson(),
  };
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

function clientHeaders(cookie?: string): Headers {
  const h = new Headers({ [TURNSTILE_HEADER]: 'ok', 'x-forwarded-for': '10.0.9.1' });
  if (cookie !== undefined) h.set('cookie', cookie);
  return h;
}

async function signedInCookie(entityRoles: Parameters<typeof createTestUser>[0]) {
  const user = await createTestUser(entityRoles, { status: 'invited' });
  await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: '/set-password' } });
  const token = /reset-password\/([^?\s]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1];
  if (token === undefined) throw new Error('no set-password link in the mail');
  await auth.api.resetPassword({
    body: { newPassword: PASSWORD, token },
    headers: clientHeaders(),
  });
  const { headers } = await auth.api.signInEmail({
    body: { email: user.email, password: PASSWORD },
    headers: clientHeaders(),
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .join('; ');
  return { user, cookie };
}

function principalFrom(cookie: string | undefined, activeEntity?: number) {
  return async () =>
    requirePrincipal(
      await resolveSessionPrincipal(clientHeaders(cookie), activeEntity, {
        auth,
        keyValue,
        now: () => clock,
      }),
    );
}

const call = (principal: ReturnType<typeof principalFrom>) =>
  issueRealtimeToken(
    new Request(`${ISSUER}/api/v1/realtime/token`, {
      method: 'POST',
      headers: { origin: ISSUER },
    }),
    { principal, env, now: () => clock },
  );

describe('POST /api/v1/realtime/token with a real session', () => {
  it('names the signed-in person, their entities and their role', async () => {
    const { user, cookie } = await signedInCookie([
      { entityId: 1, roleKey: 'tele_caller_cc' },
      { entityId: 2, roleKey: 'tele_caller_cc' },
    ]);
    const response = await call(principalFrom(cookie));
    expect(response.status).toBe(200);
    const { token, channels } = RealtimeTokenResponse.parse(await response.json());
    expect(channels).toEqual([
      `user:${user.id}`,
      'entity:1:queue',
      'entity:1:board',
      'entity:2:queue',
      'entity:2:board',
    ]);
    const jwks = JwksResponse.parse(await (await jwksDocument(env)).json());
    const claims = await verifyRealtimeToken(token, jwks, ISSUER, clock);
    expect(claims).toMatchObject({
      sub: user.id,
      entity_ids: [1, 2],
      bos_role: 'tele_caller_cc',
      role: 'authenticated',
      aud: 'shakti-realtime',
    });
  });

  it('narrows the entities to the one the person switched to', async () => {
    const { cookie } = await signedInCookie([
      { entityId: 1, roleKey: 'tele_caller_cc' },
      { entityId: 3, roleKey: 'tele_caller_cc' },
    ]);
    const response = await call(principalFrom(cookie, 3));
    const { token } = RealtimeTokenResponse.parse(await response.json());
    const jwks = JwksResponse.parse(await (await jwksDocument(env)).json());
    expect((await verifyRealtimeToken(token, jwks, ISSUER, clock)).entity_ids).toEqual([3]);
  });

  it('refuses a caller with no session, or with a session that was signed out', async () => {
    const none = await call(principalFrom(undefined));
    expect(none.status).toBe(401);
    expect(ErrorEnvelope.parse(await none.json()).error.code).toBe('unauthorized');

    const { cookie } = await signedInCookie([{ entityId: 1, roleKey: 'field_engineer' }]);
    await auth.api.signOut({ headers: clientHeaders(cookie) });
    expect((await call(principalFrom(cookie))).status).toBe(401);
  });

  it('refuses an Executive who has not set up an authenticator app yet', async () => {
    const { cookie } = await signedInCookie([{ entityId: 1, roleKey: 'executive' }]);
    const response = await call(principalFrom(cookie));
    expect(response.status).toBe(401);
    expect(ErrorEnvelope.parse(await response.json()).error.details).toEqual({
      reason: 'totp_required',
    });
  });
});
