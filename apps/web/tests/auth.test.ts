import { asMigrator, closeDb, createTestUser } from '@shakti/db/testing';
import { memoryKeyValue, memoryMailer } from '@shakti/domain';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth, type Auth } from '../src/auth/create-auth';
import { toDomainError } from '../src/auth/errors';
import {
  invalidatePrincipal,
  requirePrincipal,
  resolveSessionPrincipal,
} from '../src/auth/session-principal';
import { TURNSTILE_HEADER } from '../src/auth/turnstile';

// Real Postgres (auth_service and app_user), in-memory Redis and mail, stubbed Turnstile and
// breached-password services. Nothing here talks to the internet.

let clock = new Date('2026-09-27T10:00:00Z');
const keyValue = memoryKeyValue(() => clock.getTime());
const mailer = memoryMailer();
let breachedSuffixes: string[] = [];
// Long enough to satisfy Better Auth, low-entropy so the secret scan does not mistake it for a key.
const TEST_AUTH_SECRET = 'test-only-secret-test-only-secret-test-only-secret';

const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : input.toString();
  if (url.includes('turnstile')) {
    const params = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams();
    return Promise.resolve(Response.json({ success: params.get('response') === 'ok' }));
  }
  if (url.includes('pwnedpasswords')) {
    const body = breachedSuffixes.map((s) => `${s}:3`).join('\r\n');
    return Promise.resolve(new Response(body, { status: 200 }));
  }
  return Promise.reject(new Error(`unexpected fetch ${url}`));
});

let auth: Auth;
const deps = {
  get auth() {
    return auth;
  },
  keyValue,
  now: () => clock,
};

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
  auth = createAuth(
    {
      keyValue,
      mailer,
      fetch: fetchStub,
      now: () => clock,
      turnstileSecretKey: 'secret',
    },
    { nextCookies: false, baseURL: 'http://localhost:3000', secret: TEST_AUTH_SECRET },
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

const GOOD_PASSWORD = 'monsoon pump 2026 river';

function clientHeaders(
  options: { turnstile?: string; ip?: string; cookie?: string } = {},
): Headers {
  const h = new Headers();
  h.set(TURNSTILE_HEADER, options.turnstile ?? 'ok');
  h.set('x-forwarded-for', options.ip ?? '10.0.0.1');
  if (options.cookie !== undefined) h.set('cookie', options.cookie);
  return h;
}

/** `set-cookie` values of a response → a `cookie` request header. */
function cookieHeader(headers: Headers): string {
  const values = headers.getSetCookie();
  return values.map((c) => c.split(';')[0] ?? '').join('; ');
}

async function inviteAndSetPassword(
  entityRoles: Parameters<typeof createTestUser>[0],
  password = GOOD_PASSWORD,
) {
  const user = await createTestUser(entityRoles, { status: 'invited' });
  await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: '/set-password' } });
  const mail = mailer.sent.at(-1);
  const token = /reset-password\/([^?\s]+)/.exec(mail?.text ?? '')?.[1];
  if (token === undefined) throw new Error('no set-password link in the mail');
  await auth.api.resetPassword({ body: { newPassword: password, token } });
  return user;
}

async function signIn(
  email: string,
  password: string,
  options: Parameters<typeof clientHeaders>[0] = {},
) {
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password },
    headers: clientHeaders(options),
    returnHeaders: true,
  });
  return { cookie: cookieHeader(headers), response };
}

const code = (e: unknown) => {
  const domain = toDomainError(e);
  return domain.details?.reason ?? domain.code;
};

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

describe('invite, set password, sign in', () => {
  it('activates the invited user on the first password and signs them in', async () => {
    const user = await inviteAndSetPassword([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const [row] = await asMigrator(
      (m) =>
        m<
          { status: string; email_verified: boolean }[]
        >`select status, email_verified from users where id = ${user.id}`,
    );
    expect(row).toEqual({ status: 'active', email_verified: true });
    expect(mailer.sent.at(-1)?.to).toBe(user.email);
    expect(mailer.sent.at(-1)?.text).not.toContain('{');

    const { cookie } = await signIn(user.email, GOOD_PASSWORD);
    expect(cookie).toContain('shakti.session_token=');
    const resolved = await resolveSessionPrincipal(clientHeaders({ cookie }), undefined, deps);
    expect(requirePrincipal(resolved)).toMatchObject({
      id: user.id,
      kind: 'user',
      roleKey: 'tele_caller_cc',
      entityIds: [1],
    });
    const [login] = await asMigrator(
      (m) =>
        m<{ last_login_at: Date | null }[]>`select last_login_at from users where id = ${user.id}`,
    );
    expect(login?.last_login_at).not.toBeNull();
  });

  it('refuses a breached password and a short one', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }], {
      status: 'invited',
    });
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/set-password' },
    });
    const token = /reset-password\/([^?\s]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';
    // SHA-1 of "password12345678" without its first five characters, as the range service returns it
    const sha1 = (await import('node:crypto'))
      .createHash('sha1')
      .update('password12345678')
      .digest('hex')
      .toUpperCase();
    breachedSuffixes = [sha1.slice(5)];
    await expect(
      auth.api.resetPassword({ body: { newPassword: 'password12345678', token } }),
    ).rejects.toSatisfy((e) => code(e) === 'password_breached');
    breachedSuffixes = [];
    await expect(
      auth.api.resetPassword({ body: { newPassword: 'short', token } }),
    ).rejects.toSatisfy((e) => code(e) === 'password_too_short');
  });

  it('needs a valid bot check and locks the account after five failures', async () => {
    const user = await inviteAndSetPassword([{ entityId: 2, roleKey: 'store_manager' }]);
    await expect(signIn(user.email, GOOD_PASSWORD, { turnstile: 'nope' })).rejects.toSatisfy(
      (e) => code(e) === 'bot_check_failed',
    );
    for (let i = 0; i < 5; i += 1) {
      await expect(signIn(user.email, 'wrong password here', { ip: '10.0.0.9' })).rejects.toSatisfy(
        (e) => code(e) === 'sign_in_failed',
      );
    }
    await expect(signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.9' })).rejects.toSatisfy(
      (e) => code(e) === 'account_locked',
    );
    // the address is locked too, for any account
    await expect(
      signIn('someone.else@shakti.test', GOOD_PASSWORD, { ip: '10.0.0.9' }),
    ).rejects.toSatisfy((e) => code(e) === 'account_locked');
    clock = new Date(clock.getTime() + 61_000);
    const { cookie } = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.9' });
    expect(cookie).toContain('session_token');
  });

  it('a suspended user cannot sign in, a live session of theirs is blocked, and an unknown session resolves to nothing', async () => {
    const user = await inviteAndSetPassword([{ entityId: 1, roleKey: 'hr_admin' }]);
    const { cookie } = await signIn(user.email, GOOD_PASSWORD);
    await asMigrator((m) => m`update users set status = 'suspended' where id = ${user.id}`);
    await expect(signIn(user.email, GOOD_PASSWORD)).rejects.toSatisfy(
      (e) => code(e) === 'sign_in_failed',
    );
    await invalidatePrincipal(keyValue, user.id);
    const blocked = await resolveSessionPrincipal(clientHeaders({ cookie }), undefined, deps);
    expect(blocked?.blocked).toBe('inactive');
    expect(requirePrincipal(blocked)).toBeUndefined();
    expect(
      await resolveSessionPrincipal(
        clientHeaders({ cookie: 'shakti.session_token=nothing' }),
        undefined,
        deps,
      ),
    ).toBeUndefined();
  });
});

describe('authenticator app for Executive, GM and Accounts', () => {
  it('blocks actions until enrolled, then asks for a code at every sign-in', async () => {
    const user = await inviteAndSetPassword([
      { entityId: 1, roleKey: 'executive' },
      { entityId: 2, roleKey: 'executive' },
    ]);
    const first = await signIn(user.email, GOOD_PASSWORD);
    expect(first.response).not.toHaveProperty('twoFactorRedirect');
    const pending = await resolveSessionPrincipal(
      clientHeaders({ cookie: first.cookie }),
      undefined,
      deps,
    );
    expect(pending?.principal).toBeUndefined();
    expect(() => requirePrincipal(pending)).toThrow(
      expect.objectContaining({ code: 'unauthorized', details: { reason: 'totp_required' } }),
    );

    // a second sign-in on another device, to be ended by the enrolment
    const other = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.2' });

    const enrol = await auth.api.enableTwoFactor({
      body: { password: GOOD_PASSWORD, method: 'totp' },
      headers: clientHeaders({ cookie: first.cookie }),
      returnHeaders: true,
    });
    if (enrol.response.method !== 'totp') throw new Error('expected a totp enrolment');
    const secret = new URL(enrol.response.totpURI).searchParams.get('secret') ?? '';
    expect(enrol.response.totpURI.startsWith('otpauth://totp/Shakti%20Prime')).toBe(true);
    expect(enrol.response.backupCodes).toHaveLength(10);

    await expect(
      auth.api.verifyTOTP({
        body: { code: '000000' },
        headers: clientHeaders({ cookie: first.cookie }),
      }),
    ).rejects.toSatisfy((e) => code(e) === 'code_incorrect');
    const verified = await auth.api.verifyTOTP({
      body: { code: totpCode(secret, new Date()) },
      headers: clientHeaders({ cookie: first.cookie }),
      returnHeaders: true,
    });
    const enrolledCookie = cookieHeader(verified.headers) || first.cookie;
    const [row] = await asMigrator(
      (m) =>
        m<
          { two_factor_enabled: boolean }[]
        >`select two_factor_enabled from users where id = ${user.id}`,
    );
    expect(row?.two_factor_enabled).toBe(true);
    await invalidatePrincipal(keyValue, user.id);
    const resolved = await resolveSessionPrincipal(
      clientHeaders({ cookie: enrolledCookie }),
      2,
      deps,
    );
    expect(requirePrincipal(resolved)).toMatchObject({ roleKey: 'executive', entityIds: [2] });
    expect(other.cookie).toContain('session_token');

    // from now on a password alone is not enough, and no device is ever remembered
    const again = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.3' });
    expect(again.response).toMatchObject({ twoFactorRedirect: true });
    expect(again.cookie).toContain('two_factor=');
    expect(
      await resolveSessionPrincipal(clientHeaders({ cookie: again.cookie }), undefined, deps),
    ).toBeUndefined();
    await expect(
      auth.api.verifyTOTP({
        body: { code: totpCode(secret, new Date()), trustDevice: true },
        headers: clientHeaders({ cookie: again.cookie }),
      }),
    ).rejects.toSatisfy((e) => code(e) === 'request_refused');
    const done = await auth.api.verifyTOTP({
      body: { code: totpCode(secret, new Date()) },
      headers: clientHeaders({ cookie: again.cookie }),
      returnHeaders: true,
    });
    const signedIn = await resolveSessionPrincipal(
      clientHeaders({ cookie: cookieHeader(done.headers) }),
      undefined,
      deps,
    );
    expect(requirePrincipal(signedIn)?.entityIds).toEqual([1, 2]);
    // a switcher cookie naming an entity the user does not hold falls back to all companies
    const stale = await resolveSessionPrincipal(
      clientHeaders({ cookie: cookieHeader(done.headers) }),
      4,
      deps,
    );
    expect(requirePrincipal(stale)?.entityIds).toEqual([1, 2]);
  });

  it('a backup code signs in once', async () => {
    const user = await inviteAndSetPassword([{ entityId: 3, roleKey: 'accounts' }]);
    const first = await signIn(user.email, GOOD_PASSWORD);
    const enrol = await auth.api.enableTwoFactor({
      body: { password: GOOD_PASSWORD, method: 'totp' },
      headers: clientHeaders({ cookie: first.cookie }),
    });
    if (enrol.method !== 'totp') throw new Error('expected a totp enrolment');
    const secret = new URL(enrol.totpURI).searchParams.get('secret') ?? '';
    await auth.api.verifyTOTP({
      body: { code: totpCode(secret, new Date()) },
      headers: clientHeaders({ cookie: first.cookie }),
    });
    const backup = enrol.backupCodes[0] ?? '';
    const challenge = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.4' });
    await expect(
      auth.api.verifyBackupCode({
        body: { code: 'not-a-code' },
        headers: clientHeaders({ cookie: challenge.cookie }),
      }),
    ).rejects.toSatisfy((e) => code(e) === 'backup_code_incorrect');
    const done = await auth.api.verifyBackupCode({
      body: { code: backup },
      headers: clientHeaders({ cookie: challenge.cookie }),
      returnHeaders: true,
    });
    const signedIn = await resolveSessionPrincipal(
      clientHeaders({ cookie: cookieHeader(done.headers) }),
      undefined,
      deps,
    );
    expect(requirePrincipal(signedIn)?.entityIds).toEqual([3]);
    const second = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.5' });
    await expect(
      auth.api.verifyBackupCode({
        body: { code: backup },
        headers: clientHeaders({ cookie: second.cookie }),
      }),
    ).rejects.toSatisfy((e) => code(e) === 'backup_code_incorrect');
  });
});

describe('request caps and cookie attributes', () => {
  it('caps password-reset requests per address and names the session cookie __Host- in production', async () => {
    const capped = createAuth(
      { keyValue, mailer, fetch: fetchStub, now: () => clock, turnstileSecretKey: 'secret' },
      {
        nextCookies: false,
        baseURL: 'http://localhost:3000',
        secret: TEST_AUTH_SECRET,
        rateLimit: true,
        secureCookies: true,
      },
    );
    const user = await inviteAndSetPassword([{ entityId: 1, roleKey: 'field_engineer' }]);
    const request = () =>
      capped.api.requestPasswordReset({
        body: { email: user.email, redirectTo: '/set-password' },
        headers: clientHeaders({ ip: '10.0.7.7' }),
      });
    for (let i = 0; i < 3; i += 1) await request();
    await expect(request()).rejects.toSatisfy((e) => code(e) === 'account_locked');

    const { headers } = await capped.api.signInEmail({
      body: { email: user.email, password: GOOD_PASSWORD },
      headers: clientHeaders({ ip: '10.0.7.8' }),
      returnHeaders: true,
    });
    const sessionCookie = headers
      .getSetCookie()
      .find((c) => c.startsWith('__Host-shakti-session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/; *Secure/i);
    expect(sessionCookie).toMatch(/; *HttpOnly/i);
    expect(sessionCookie).not.toMatch(/Domain=/i);
  });
});

describe('session limits', () => {
  it('a revoked session and one past the absolute limit resolve to nothing', async () => {
    const user = await inviteAndSetPassword([{ entityId: 3, roleKey: 'project_manager' }]);
    const { cookie } = await signIn(user.email, GOOD_PASSWORD);
    const resolved = await resolveSessionPrincipal(clientHeaders({ cookie }), undefined, deps);
    const sessionId = resolved?.session.sessionId ?? '';
    expect(sessionId).not.toBe('');

    await asMigrator(
      (m) => m`update sessions set created_at = now() - interval '8 days' where id = ${sessionId}`,
    );
    await invalidatePrincipal(keyValue, user.id);
    expect(
      await resolveSessionPrincipal(clientHeaders({ cookie }), undefined, deps),
    ).toBeUndefined();
    const [row] = await asMigrator(
      (m) =>
        m<
          { revoked_reason: string | null }[]
        >`select revoked_reason from sessions where id = ${sessionId}`,
    );
    expect(row?.revoked_reason).toBe('absolute_expiry');

    const second = await signIn(user.email, GOOD_PASSWORD);
    const live = await resolveSessionPrincipal(
      clientHeaders({ cookie: second.cookie }),
      undefined,
      deps,
    );
    expect(live?.principal).toBeDefined();
    await asMigrator(
      (m) =>
        m`update sessions set revoked_at = now(), revoked_reason = 'admin' where id = ${live?.session.sessionId ?? ''}`,
    );
    expect(
      await resolveSessionPrincipal(clientHeaders({ cookie: second.cookie }), undefined, deps),
    ).toBeUndefined();
    // the auth routes refuse the revoked session too, not only currentPrincipal()
    await expect(
      auth.api.getSession({ headers: clientHeaders({ cookie: second.cookie }) }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      auth.api.changePassword({
        body: { currentPassword: GOOD_PASSWORD, newPassword: `${GOOD_PASSWORD} again` },
        headers: clientHeaders({ cookie: second.cookie }),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    // a sign-out with a revoked cookie still answers, so the screen can end cleanly
    await expect(
      auth.api.signOut({ headers: clientHeaders({ cookie: second.cookie }) }),
    ).resolves.toBeDefined();
  });
});
