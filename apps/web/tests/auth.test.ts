import { closeAuthDb } from '@shakti/db/auth';
import { asMigrator, closeDb, createTestPrincipal, createTestUser } from '@shakti/db/testing';
import { executeCommand, memoryKeyValue, memoryMailer, resetTwoFactor } from '@shakti/domain';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  clearSignInLock,
  createAuth,
  HTTP_DISABLED_PATHS,
  setPasswordMailFailed,
  type Auth,
} from '../src/auth/create-auth';
import * as clientAddressModule from '../src/auth/client-address';
import { toDomainError } from '../src/auth/errors';
import {
  finishEnrolment,
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
    // A token reads `ok` (the sign-in widget) or `ok:<widget>`, the way Cloudflare echoes it.
    const [verdict, action = 'sign-in'] = (params.get('response') ?? '').split(':');
    return Promise.resolve(
      Response.json({ success: verdict === 'ok', hostname: 'localhost', action }),
    );
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
  await closeAuthDb();
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
  // Headers as the set-password screen sends them, so the audit row has its address.
  await auth.api.resetPassword({
    body: { newPassword: password, token },
    headers: clientHeaders(),
  });
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

  it('needs a valid bot check and locks the account from that address after five failures (AUDIT M6)', async () => {
    const user = await inviteAndSetPassword([{ entityId: 2, roleKey: 'store_manager' }]);
    const colleague = await inviteAndSetPassword([{ entityId: 2, roleKey: 'store_manager' }]);
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
    // a colleague behind the same office address is not locked out by someone else's typos
    await expect(signIn(colleague.email, GOOD_PASSWORD, { ip: '10.0.0.9' })).resolves.toMatchObject(
      { cookie: expect.stringContaining('session_token') as unknown },
    );
    // and a stranger's failures elsewhere cannot keep the owner out from their own address
    await expect(signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.10' })).resolves.toMatchObject({
      cookie: expect.stringContaining('session_token') as unknown,
    });
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
    // The enrolment ends every other sign-in of the user (AUDIT M41: set up before, now asserted).
    await finishEnrolment(pending, verified.headers, keyValue);
    expect(
      await resolveSessionPrincipal(clientHeaders({ cookie: other.cookie }), undefined, deps),
    ).toBeUndefined();
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
    // the code of the next time step: the enrolment code is spent (AUDIT M5)
    const done = await auth.api.verifyTOTP({
      body: { code: totpCode(secret, new Date(Date.now() + 30_000)) },
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

  it('after an Executive resets a lost app, the password signs in and a new app must be set up', async () => {
    const user = await inviteAndSetPassword([{ entityId: 3, roleKey: 'accounts' }]);
    const first = await signIn(user.email, GOOD_PASSWORD);
    const enrol = await auth.api.enableTwoFactor({
      body: { password: GOOD_PASSWORD, method: 'totp' },
      headers: clientHeaders({ cookie: first.cookie }),
    });
    if (enrol.method !== 'totp') throw new Error('expected a totp enrolment');
    const verified = await auth.api.verifyTOTP({
      body: { code: totpCode(new URL(enrol.totpURI).searchParams.get('secret') ?? '', new Date()) },
      headers: clientHeaders({ cookie: first.cookie }),
      returnHeaders: true,
    });
    const enrolledCookie = cookieHeader(verified.headers) || first.cookie;
    expect((await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.6' })).response).toMatchObject({
      twoFactorRedirect: true,
    });

    const exec = await createTestPrincipal('executive');
    await executeCommand(exec, {}, resetTwoFactor, { userId: user.id });
    await invalidatePrincipal(keyValue, user.id);

    // every earlier sign-in has ended
    expect(
      await resolveSessionPrincipal(clientHeaders({ cookie: enrolledCookie }), undefined, deps),
    ).toBeUndefined();
    // the password alone signs in, and the app stays closed until a new authenticator is set up
    const after = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.0.7' });
    expect(after.response).not.toHaveProperty('twoFactorRedirect');
    const pending = await resolveSessionPrincipal(
      clientHeaders({ cookie: after.cookie }),
      undefined,
      deps,
    );
    expect(() => requirePrincipal(pending)).toThrow(
      expect.objectContaining({ code: 'unauthorized', details: { reason: 'totp_required' } }),
    );
    const again = await auth.api.enableTwoFactor({
      body: { password: GOOD_PASSWORD, method: 'totp' },
      headers: clientHeaders({ cookie: after.cookie }),
    });
    expect(again.method).toBe('totp');
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
        headers: clientHeaders({ ip: '10.0.7.7', turnstile: 'ok:reset' }),
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

  it('counts callers whose address cannot be read under one shared cap, and never an invite', async () => {
    const capped = createAuth(
      { keyValue, mailer, fetch: fetchStub, now: () => clock, turnstileSecretKey: 'secret' },
      {
        nextCookies: false,
        baseURL: 'http://localhost:3000',
        secret: TEST_AUTH_SECRET,
        rateLimit: true,
      },
    );
    const user = await inviteAndSetPassword([{ entityId: 1, roleKey: 'field_engineer' }]);
    // As on a host that forwards no address: the caps must still hold.
    const unreadable = vi.spyOn(clientAddressModule, 'clientAddress').mockReturnValue(undefined);
    try {
      const request = (ip: string) =>
        capped.api.requestPasswordReset({
          body: { email: user.email, redirectTo: '/set-password' },
          headers: clientHeaders({ ip, turnstile: 'ok:reset' }),
        });
      for (const ip of ['10.0.8.1', '10.0.8.2', '10.0.8.3']) await request(ip);
      await expect(request('10.0.8.4')).rejects.toSatisfy((e) => code(e) === 'account_locked');
      // Our own server code (an invite) sends no headers and is not counted.
      await expect(
        capped.api.requestPasswordReset({
          body: { email: user.email, redirectTo: '/set-password' },
        }),
      ).resolves.toMatchObject({ status: true });
    } finally {
      unreadable.mockRestore();
    }
    // A caller whose address is known counts on its own.
    await expect(
      capped.api.requestPasswordReset({
        body: { email: user.email, redirectTo: '/set-password' },
        headers: clientHeaders({ ip: '10.0.8.5', turnstile: 'ok:reset' }),
      }),
    ).resolves.toMatchObject({ status: true });
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
      // Aged on the suite's own clock, which deps.now() also reads; Postgres now() would drift from it.
      (m) =>
        m`update sessions set created_at = ${new Date(clock.getTime() - 8 * 86_400_000)} where id = ${sessionId}`,
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

  it('a browser still holding an ended session can sign in and set a password again', async () => {
    const ip = '10.0.7.1';
    const user = await inviteAndSetPassword([{ entityId: 3, roleKey: 'project_manager' }]);
    const stale = await signIn(user.email, GOOD_PASSWORD, { ip });
    const resolved = await resolveSessionPrincipal(
      clientHeaders({ cookie: stale.cookie }),
      undefined,
      deps,
    );
    await asMigrator(
      (m) =>
        m`update sessions set revoked_at = now(), revoked_reason = 'admin' where id = ${resolved?.session.sessionId ?? ''}`,
    );

    const again = await signIn(user.email, GOOD_PASSWORD, { ip, cookie: stale.cookie });
    const live = await resolveSessionPrincipal(
      clientHeaders({ cookie: again.cookie }),
      undefined,
      deps,
    );
    expect(live?.principal).toBeDefined();

    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/set-password' },
      headers: clientHeaders({ ip, cookie: stale.cookie, turnstile: 'ok:reset' }),
    });
    const token = /reset-password\/([^?\s]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1];
    expect(token).toBeDefined();
    await expect(
      auth.api.resetPassword({
        body: { newPassword: `${GOOD_PASSWORD} anew`, token: token ?? '' },
        headers: clientHeaders({ ip, cookie: stale.cookie }),
      }),
    ).resolves.toMatchObject({ status: true });
  });
});

/** An Executive with an enrolled authenticator app; answers the secret for making codes. */
async function enrolledExecutive(entityId = 1) {
  const user = await inviteAndSetPassword([{ entityId, roleKey: 'executive' }]);
  const first = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.9.1' });
  const enrol = await auth.api.enableTwoFactor({
    body: { password: GOOD_PASSWORD, method: 'totp' },
    headers: clientHeaders({ cookie: first.cookie, ip: '10.0.9.1' }),
  });
  if (enrol.method !== 'totp') throw new Error('expected a totp enrolment');
  const secret = new URL(enrol.totpURI).searchParams.get('secret') ?? '';
  // enrolment spends the code of the step before now, leaving now and the next step free; near the
  // end of a 30-second step that code would turn two steps old before the server checks it, so
  // wait for the next step to begin
  const intoStep = Date.now() % 30_000;
  if (intoStep > 27_000) await new Promise((done) => setTimeout(done, 30_100 - intoStep));
  await auth.api.verifyTOTP({
    body: { code: totpCode(secret, new Date(Date.now() - 30_000)) },
    headers: clientHeaders({ cookie: first.cookie, ip: '10.0.9.1' }),
  });
  return { user, secret };
}

const lastLogin = async (userId: string) => {
  const [row] = await asMigrator(
    (m) => m<{ at: Date | null }[]>`select last_login_at as at from users where id = ${userId}`,
  );
  return row?.at ?? null;
};

describe('second factor (AUDIT M5, L21)', () => {
  it('a code verifies once, and the sign-in counts only when the code is done', async () => {
    const { user, secret } = await enrolledExecutive();
    await asMigrator((m) => m`update users set last_login_at = null where id = ${user.id}`);
    const challenge = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.9.2' });
    expect(challenge.response).toMatchObject({ twoFactorRedirect: true });
    expect(await lastLogin(user.id)).toBeNull();

    const totp = totpCode(secret, new Date());
    await auth.api.verifyTOTP({
      body: { code: totp },
      headers: clientHeaders({ cookie: challenge.cookie, ip: '10.0.9.2' }),
    });
    expect(await lastLogin(user.id)).not.toBeNull();

    const replay = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.9.3' });
    await expect(
      auth.api.verifyTOTP({
        body: { code: totp },
        headers: clientHeaders({ cookie: replay.cookie, ip: '10.0.9.3' }),
      }),
    ).rejects.toSatisfy((e) => code(e) === 'code_incorrect');
  });

  it('five wrong codes lock the second factor, even with a fresh challenge', async () => {
    const { user, secret } = await enrolledExecutive();
    const challenge = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.9.4' });
    for (const wrong of ['000001', '000002', '000003', '000004', '000005']) {
      await expect(
        auth.api.verifyTOTP({
          body: { code: wrong },
          headers: clientHeaders({ cookie: challenge.cookie, ip: '10.0.9.4' }),
        }),
      ).rejects.toSatisfy((e) => code(e) === 'code_incorrect');
    }
    const fresh = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.9.4' });
    await expect(
      auth.api.verifyTOTP({
        body: { code: totpCode(secret, new Date(Date.now() + 30_000)) },
        headers: clientHeaders({ cookie: fresh.cookie, ip: '10.0.9.4' }),
      }),
    ).rejects.toSatisfy((e) => code(e) === 'account_locked');
  });

  it('a user suspended between the password and the code gets no session', async () => {
    const { user, secret } = await enrolledExecutive(2);
    const challenge = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.9.5' });
    await asMigrator((m) => m`update users set status = 'suspended' where id = ${user.id}`);
    const before = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from sessions where user_id = ${user.id}`,
    );
    await expect(
      auth.api.verifyTOTP({
        body: { code: totpCode(secret, new Date(Date.now() + 30_000)) },
        headers: clientHeaders({ cookie: challenge.cookie, ip: '10.0.9.5' }),
      }),
    ).rejects.toBeDefined();
    const after = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from sessions where user_id = ${user.id}`,
    );
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('sign-in lock policy (AUDIT M6, L21)', () => {
  it('a suspended account locks like any other, so the lock does not reveal it', async () => {
    const user = await inviteAndSetPassword([{ entityId: 4, roleKey: 'hr_admin' }]);
    await asMigrator((m) => m`update users set status = 'suspended' where id = ${user.id}`);
    for (let i = 0; i < 5; i += 1) {
      await expect(signIn(user.email, GOOD_PASSWORD, { ip: '10.0.8.1' })).rejects.toSatisfy(
        (e) => code(e) === 'sign_in_failed',
      );
    }
    await expect(signIn(user.email, GOOD_PASSWORD, { ip: '10.0.8.1' })).rejects.toSatisfy(
      (e) => code(e) === 'account_locked',
    );
  });

  it('tells the owner after ten wrong passwords from anywhere, and an administrator can lift the lock', async () => {
    const user = await inviteAndSetPassword([{ entityId: 4, roleKey: 'field_engineer' }]);
    const before = mailer.sent.length;
    for (let i = 0; i < 10; i += 1) {
      await expect(
        signIn(user.email, 'wrong password here', { ip: `10.0.8.${String(10 + (i % 2))}` }),
      ).rejects.toSatisfy((e) => code(e) === 'sign_in_failed');
    }
    const notices = mailer.sent
      .slice(before)
      .filter((m) => m.to === user.email && m.subject.includes('tried to sign in'));
    expect(notices).toHaveLength(1);

    await expect(signIn(user.email, GOOD_PASSWORD, { ip: '10.0.8.10' })).rejects.toSatisfy(
      (e) => code(e) === 'account_locked',
    );
    await clearSignInLock({ keyValue, now: () => clock }, user.email);
    await expect(signIn(user.email, GOOD_PASSWORD, { ip: '10.0.8.10' })).resolves.toBeDefined();
  });
});

describe('set-password links (AUDIT M7, M27)', () => {
  const links = (userId: string) =>
    asMigrator(
      (m) => m<{ identifier: string; expires_at: Date }[]>`
        select identifier, expires_at from auth_verifications
         where value = ${userId} and identifier like 'reset-password:%'`,
    );
  const linkIn = (text: string | undefined) =>
    /reset-password\/([^?\s]+)/.exec(text ?? '')?.[1] ?? '';

  it('an invitation lasts a day, a reset an hour, only the newest works, and none is stored readable', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'accounts' }], {
      status: 'invited',
    });
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/set-password' },
    });
    const invite = linkIn(mailer.sent.at(-1)?.text);
    expect(mailer.sent.at(-1)?.text).toContain('one day');
    const [inviteRow] = await links(user.id);
    expect(inviteRow?.identifier).not.toContain(invite);
    const inviteHours = ((inviteRow?.expires_at.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(inviteHours).toBeGreaterThan(23);

    await auth.api.resetPassword({ body: { newPassword: GOOD_PASSWORD, token: invite } });
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/set-password' },
    });
    const first = linkIn(mailer.sent.at(-1)?.text);
    expect(mailer.sent.at(-1)?.text).toContain('one hour');
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/set-password' },
    });
    const second = linkIn(mailer.sent.at(-1)?.text);
    const rows = await links(user.id);
    expect(rows).toHaveLength(1);
    const resetHours = ((rows[0]?.expires_at.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(resetHours).toBeLessThanOrEqual(1);

    await expect(
      auth.api.resetPassword({ body: { newPassword: `${GOOD_PASSWORD} one`, token: first } }),
    ).rejects.toBeDefined();
    await expect(
      auth.api.resetPassword({ body: { newPassword: `${GOOD_PASSWORD} two`, token: second } }),
    ).resolves.toMatchObject({ status: true });
  });

  it('six people set their passwords from one office address; one link cannot be tried endlessly', async () => {
    const capped = createAuth(
      { keyValue, mailer, fetch: fetchStub, now: () => clock, turnstileSecretKey: 'secret' },
      {
        nextCookies: false,
        baseURL: 'http://localhost:3000',
        secret: TEST_AUTH_SECRET,
        rateLimit: true,
      },
    );
    const office = clientHeaders({ ip: '10.0.6.1' });
    for (let i = 0; i < 6; i += 1) {
      const invitee = await createTestUser([{ entityId: 2, roleKey: 'tele_caller_cc' }], {
        status: 'invited',
      });
      await capped.api.requestPasswordReset({
        body: { email: invitee.email, redirectTo: '/set-password' },
      });
      const token = linkIn(mailer.sent.at(-1)?.text);
      await expect(
        capped.api.resetPassword({ body: { newPassword: GOOD_PASSWORD, token }, headers: office }),
      ).resolves.toMatchObject({ status: true });
    }
    const probe = clientHeaders({ ip: '10.0.6.2' });
    const guess = () =>
      capped.api.resetPassword({
        body: { newPassword: GOOD_PASSWORD, token: 'guessed-link' },
        headers: probe,
      });
    for (let i = 0; i < 5; i += 1) {
      await expect(guess()).rejects.toSatisfy((e) => code(e) !== 'account_locked');
    }
    await expect(guess()).rejects.toSatisfy((e) => code(e) === 'account_locked');
  });
});

describe('endpoints served over HTTP (AUDIT M4)', () => {
  /** The link in a set-password email, and Better Auth's own status pages. */
  const SERVED = new Set(['/reset-password/:token', '/ok', '/error']);
  /** Answers not found by itself: no social sign-in provider is configured. */
  const INERT = new Set(['/callback/:id']);

  it('every endpoint is either one the screens need over HTTP or switched off', () => {
    const paths = Object.values(auth.api as Record<string, { path?: unknown }>)
      .map((endpoint) => endpoint.path)
      .filter((path): path is string => typeof path === 'string');
    expect(paths.length).toBeGreaterThan(20);
    const open = paths.filter(
      (path) => !SERVED.has(path) && !INERT.has(path) && !HTTP_DISABLED_PATHS.includes(path),
    );
    expect(open).toEqual([]);
  });

  it('answers not found for a profile update or an authenticator removal over HTTP', async () => {
    for (const path of ['/update-user', '/two-factor/disable', '/sign-in/email']) {
      const response = await auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
          body: '{}',
        }),
      );
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
  });
});

describe('an outage is not a sign-out (AUDIT M36, M37)', () => {
  it('a failing session lookup reaches the error screen instead of reading as signed out', async () => {
    const broken = {
      keyValue,
      now: () => clock,
      auth: {
        api: { getSession: () => Promise.reject(new Error('connection terminated')) },
      } as unknown as Auth,
    };
    await expect(resolveSessionPrincipal(clientHeaders(), undefined, broken)).rejects.toThrow(
      'connection terminated',
    );
  });

  it('an unreachable bot check reads as an outage, not as a bot', async () => {
    const offline = createAuth(
      {
        keyValue,
        mailer,
        fetch: () => Promise.reject(new TypeError('fetch failed')),
        now: () => clock,
        turnstileSecretKey: 'secret',
      },
      { nextCookies: false, baseURL: 'http://localhost:3000', secret: TEST_AUTH_SECRET },
    );
    await expect(
      offline.api.signInEmail({
        body: { email: 'anyone@shakti.test', password: GOOD_PASSWORD },
        headers: clientHeaders(),
      }),
    ).rejects.toSatisfy((e) => code(e) === 'bot_check_unavailable');
  });
});

describe('an invitation email that does not go out (AUDIT M26)', () => {
  it('is recorded once for the invite action to report', async () => {
    const failing = createAuth(
      {
        keyValue,
        mailer: { send: () => Promise.reject(new Error('mail service down')) },
        fetch: fetchStub,
        now: () => clock,
        turnstileSecretKey: 'secret',
      },
      { nextCookies: false, baseURL: 'http://localhost:3000', secret: TEST_AUTH_SECRET },
    );
    const user = await createTestUser([{ entityId: 1, roleKey: 'accounts' }], {
      status: 'invited',
    });
    await failing.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/set-password' },
    });
    expect(await setPasswordMailFailed({ keyValue }, user.id)).toBe(true);
    expect(await setPasswordMailFailed({ keyValue }, user.id)).toBe(false);
  });
});

describe('guards the audit found untested (AUDIT M41)', () => {
  it("the auth route's own hook refuses a session past the absolute limit, and records why", async () => {
    const user = await inviteAndSetPassword([{ entityId: 1, roleKey: 'store_manager' }]);
    const { cookie } = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.5.1' });
    const [row] = await asMigrator(
      (m) => m<{ id: string }[]>`
        update sessions set created_at = ${new Date(clock.getTime() - 8 * 86_400_000)}
         where user_id = ${user.id} and revoked_at is null returning id`,
    );
    await expect(
      auth.api.getSession({ headers: clientHeaders({ cookie, ip: '10.0.5.1' }) }),
    ).rejects.toMatchObject({ statusCode: 401 });
    const [after] = await asMigrator(
      (m) =>
        m<
          { reason: string | null }[]
        >`select revoked_reason as reason from sessions where id = ${row?.id ?? ''}`,
    );
    expect(after?.reason).toBe('absolute_expiry');
  });

  it('the HTTP routes are rate limited per address', async () => {
    const limited = createAuth(
      { keyValue, mailer, fetch: fetchStub, now: () => clock, turnstileSecretKey: 'secret' },
      {
        nextCookies: false,
        baseURL: 'http://localhost:3000',
        secret: TEST_AUTH_SECRET,
        rateLimit: true,
      },
    );
    const hit = () =>
      limited.handler(
        new Request('http://localhost:3000/api/auth/ok', {
          headers: { 'x-forwarded-for': '10.0.5.9' },
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 61; i += 1) statuses.push((await hit()).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});

interface AuthAuditRow {
  command: string;
  outcome: string;
  actor_principal_id: string | null;
  entity_id: number | null;
  error_code: string | null;
  input_json: Record<string, unknown> | null;
  ip: string | null;
}

/** Sign-in and account events, oldest first, read as the table owner. */
function authEvents(where: { actor?: string; ip?: string }): Promise<AuthAuditRow[]> {
  return asMigrator(
    (m) => m<AuthAuditRow[]>`
      select command, outcome, actor_principal_id, entity_id, error_code, input_json, host(ip) as ip
        from audit_logs
       where command like 'auth.%'
         and (${where.actor ?? null}::uuid is null or actor_principal_id = ${where.actor ?? null}::uuid)
         and (${where.ip ?? null}::inet is null or ip = ${where.ip ?? null}::inet)
       order by created_at, id
    `,
  );
}

describe('the audit trail of sign-in and account changes (docs/design/backend-weeks-3-5.md §2.6)', () => {
  it('records password set, wrong and right passwords, sign-out and a password change', async () => {
    const user = await inviteAndSetPassword([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    await expect(
      signIn(user.email, 'wrong password here', { ip: '10.0.7.1' }),
    ).rejects.toBeDefined();
    const { cookie } = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.7.1' });
    await auth.api.changePassword({
      body: {
        currentPassword: GOOD_PASSWORD,
        newPassword: `${GOOD_PASSWORD} changed`,
        revokeOtherSessions: true,
      },
      headers: clientHeaders({ cookie, ip: '10.0.7.1' }),
      returnHeaders: true,
    });
    const after = await signIn(user.email, `${GOOD_PASSWORD} changed`, { ip: '10.0.7.1' });
    await auth.api.signOut({ headers: clientHeaders({ cookie: after.cookie, ip: '10.0.7.1' }) });

    const rows = await authEvents({ actor: user.id });
    expect(rows.map((r) => [r.command, r.outcome])).toEqual([
      ['auth.password.set', 'ok'],
      ['auth.sign_in', 'failed'],
      ['auth.sign_in', 'ok'],
      ['auth.password.change', 'ok'],
      ['auth.sign_in', 'ok'],
      ['auth.sign_out', 'ok'],
    ]);
    // The set-password row carries the address of the screen that sent it.
    expect(rows[0]).toMatchObject({ ip: '10.0.0.1', error_code: null });
    expect(rows[1]).toMatchObject({
      error_code: 'INVALID_EMAIL_OR_PASSWORD',
      ip: '10.0.7.1',
      entity_id: null,
    });
    expect(rows[2]?.input_json).toEqual({ email: '********test', detail: 'complete' });
    expect(rows[3]?.input_json).toEqual({ revokeOtherSessions: true });
    const text = JSON.stringify(rows);
    expect(text).not.toContain(user.email);
    expect(text).not.toContain(GOOD_PASSWORD);
  });

  it('records a sign-in for an unknown address without an actor, and a locked account as refused', async () => {
    // An address of its own, so rows left by an earlier run of the suite are not counted.
    const octet = () => 1 + Math.floor(Math.random() * 250);
    const stranger = `10.${octet()}.${octet()}.${octet()}`;
    await expect(
      signIn('nobody-here@shakti.test', 'wrong password here', { ip: stranger }),
    ).rejects.toBeDefined();
    expect(await authEvents({ ip: stranger })).toEqual([
      expect.objectContaining({
        command: 'auth.sign_in',
        outcome: 'failed',
        actor_principal_id: null,
        input_json: { email: '********test' },
      }),
    ]);

    const user = await inviteAndSetPassword([{ entityId: 2, roleKey: 'store_manager' }]);
    for (let i = 0; i < 5; i += 1) {
      await expect(
        signIn(user.email, 'wrong password here', { ip: '10.0.7.3' }),
      ).rejects.toBeDefined();
    }
    await expect(signIn(user.email, GOOD_PASSWORD, { ip: '10.0.7.3' })).rejects.toSatisfy(
      (e) => code(e) === 'account_locked',
    );
    const last = (await authEvents({ actor: user.id, ip: '10.0.7.3' })).at(-1);
    expect(last).toMatchObject({
      command: 'auth.sign_in',
      outcome: 'denied',
      error_code: 'ACCOUNT_LOCKED',
      input_json: { email: '********test', detail: 'locked' },
    });
  });

  it('records the authenticator set-up and each code, never the code itself', async () => {
    const user = await inviteAndSetPassword([{ entityId: 1, roleKey: 'general_manager' }]);
    const first = await signIn(user.email, GOOD_PASSWORD, { ip: '10.0.7.4' });
    const enrol = await auth.api.enableTwoFactor({
      body: { password: GOOD_PASSWORD, method: 'totp' },
      headers: clientHeaders({ cookie: first.cookie, ip: '10.0.7.4' }),
    });
    if (enrol.method !== 'totp') throw new Error('expected a totp enrolment');
    const secret = new URL(enrol.totpURI).searchParams.get('secret') ?? '';
    await expect(
      auth.api.verifyTOTP({
        body: { code: '000000' },
        headers: clientHeaders({ cookie: first.cookie, ip: '10.0.7.4' }),
      }),
    ).rejects.toBeDefined();
    const good = totpCode(secret, new Date());
    await auth.api.verifyTOTP({
      body: { code: good },
      headers: clientHeaders({ cookie: first.cookie, ip: '10.0.7.4' }),
    });

    const rows = await authEvents({ actor: user.id, ip: '10.0.7.4' });
    expect(rows.map((r) => [r.command, r.outcome, r.input_json])).toEqual([
      ['auth.sign_in', 'ok', { email: '********test', detail: 'complete' }],
      ['auth.two_factor.enable', 'ok', {}],
      ['auth.two_factor.verify', 'failed', { method: 'totp' }],
      ['auth.two_factor.verify', 'ok', { method: 'totp' }],
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(good);
    expect(text).not.toContain(secret);
  });
});

describe('the audit trail of backup codes and forgotten passwords', () => {
  it('records new backup codes, a sign-in with one and a request for a new password', async () => {
    const ip = '10.0.7.5';
    const user = await inviteAndSetPassword([{ entityId: 3, roleKey: 'accounts' }]);
    const first = await signIn(user.email, GOOD_PASSWORD, { ip });
    const enrol = await auth.api.enableTwoFactor({
      body: { password: GOOD_PASSWORD, method: 'totp' },
      headers: clientHeaders({ cookie: first.cookie, ip }),
    });
    if (enrol.method !== 'totp') throw new Error('expected a totp enrolment');
    const secret = new URL(enrol.totpURI).searchParams.get('secret') ?? '';
    const verified = await auth.api.verifyTOTP({
      body: { code: totpCode(secret, new Date()) },
      headers: clientHeaders({ cookie: first.cookie, ip }),
      returnHeaders: true,
    });
    const enrolledCookie = cookieHeader(verified.headers) || first.cookie;

    const fresh = await auth.api.generateBackupCodes({
      body: { password: GOOD_PASSWORD },
      headers: clientHeaders({ cookie: enrolledCookie, ip }),
    });
    const backup = fresh.backupCodes[0] ?? '';
    const challenge = await signIn(user.email, GOOD_PASSWORD, { ip });
    await auth.api.verifyBackupCode({
      body: { code: backup },
      headers: clientHeaders({ cookie: challenge.cookie, ip }),
    });
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/set-password' },
      headers: clientHeaders({ ip, turnstile: 'ok:reset' }),
    });

    const rows = await authEvents({ actor: user.id, ip });
    expect(rows.map((r) => [r.command, r.outcome, r.input_json])).toEqual([
      ['auth.sign_in', 'ok', { email: '********test', detail: 'complete' }],
      ['auth.two_factor.enable', 'ok', {}],
      ['auth.two_factor.verify', 'ok', { method: 'totp' }],
      ['auth.backup_codes.regenerate', 'ok', {}],
      ['auth.sign_in', 'ok', { email: '********test', detail: 'code_required' }],
      ['auth.two_factor.verify', 'ok', { method: 'backup_code' }],
      ['auth.password.reset_requested', 'ok', { email: '********test' }],
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(backup);
    expect(text).not.toContain(user.email);
  });
});
