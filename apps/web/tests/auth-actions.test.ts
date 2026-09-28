import { closeDb, createTestUser } from '@shakti/db/testing';
import { memoryKeyValue, memoryMailer } from '@shakti/domain';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The sign-in and account form actions of `actions/auth.ts`, driven as the screens call them,
// outside a Next.js request: the request headers, cookies and redirect are stand-ins, and the
// application's Better Auth instance is one built for this file with in-memory mail and stubbed
// Turnstile and breached-password services. Better Auth, the session lookup and the database are
// real. Every call either answers a form state or ends in the redirect the screen expects; none
// throws anything else.
interface RequestState {
  headers: Headers;
  jar: Map<string, string>;
  auth: unknown;
}

const request = vi.hoisted((): RequestState => ({
  headers: new Headers(),
  jar: new Map(),
  auth: undefined,
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(request.headers),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        request.jar.has(name) ? { name, value: request.jar.get(name) } : undefined,
      set: (name: string, value: string) => {
        request.jar.set(name, value);
      },
      delete: (name: string) => {
        request.jar.delete(name);
      },
    }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock('../src/auth/auth', () => ({
  auth: new Proxy(
    {},
    { get: (_target, property) => (request.auth as Record<PropertyKey, unknown>)[property] },
  ),
}));

const { createAuth } = await import('../src/auth/create-auth');
const { TURNSTILE_HEADER } = await import('../src/auth/turnstile');
const {
  beginTwoFactor,
  changePassword,
  requestNewPassword,
  setPassword,
  signIn,
  signOut,
  verifyBackupCode,
  verifyTwoFactor,
} = await import('../src/actions/auth');

const mailer = memoryMailer();
// Long enough to satisfy Better Auth, low-entropy so the secret scan does not mistake it for a key.
const TEST_AUTH_SECRET = 'test-only-secret-for-the-form-actions-test-only';
const GOOD_PASSWORD = 'monsoon pump 2026 river';

const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : input.toString();
  if (url.includes('turnstile')) {
    const params = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams();
    const [verdict, action = 'sign-in'] = (params.get('response') ?? '').split(':');
    return Promise.resolve(
      Response.json({ success: verdict === 'ok', hostname: 'localhost', action }),
    );
  }
  if (url.includes('pwnedpasswords')) return Promise.resolve(new Response('', { status: 200 }));
  return Promise.reject(new Error(`unexpected fetch ${url}`));
});

type Auth = ReturnType<typeof createAuth>;
let auth: Auth;

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
  auth = createAuth(
    {
      keyValue: memoryKeyValue(),
      mailer,
      fetch: fetchStub,
      now: () => new Date(),
      turnstileSecretKey: 'secret',
    },
    { nextCookies: false, baseURL: 'http://localhost:3000', secret: TEST_AUTH_SECRET },
  );
  request.auth = auth;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});
beforeEach(() => {
  request.jar.clear();
  setRequest();
});

/** A network address no other test used, so the per-address sign-in caps never interfere. */
function address(): string {
  const part = () => Math.floor(Math.random() * 250) + 1;
  return `10.${String(part())}.${String(part())}.${String(part())}`;
}

/** The headers of the next action call: a fresh address and, when given, the session cookie. */
function setRequest(cookie?: string): void {
  request.headers = new Headers({ 'x-forwarded-for': address() });
  if (cookie !== undefined) request.headers.set('cookie', cookie);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** `set-cookie` values of a response → a `cookie` request header. */
function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .join('; ');
}

/** The set-password link's secret in the last mail sent. */
function lastLinkSecret(): string {
  const secret = /reset-password\/([^?\s]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1];
  if (secret === undefined) throw new Error('no set-password link in the mail');
  return secret;
}

/** An invited person who has chosen a password through the two form actions. */
async function personWithPassword(roleKey: 'tele_caller_cc' | 'accounts') {
  const user = await createTestUser([{ entityId: 1, roleKey }], { status: 'invited' });
  await requestNewPassword({}, form({ email: user.email, 'cf-turnstile-response': 'ok:reset' }));
  const done = await setPassword(
    {},
    form({ password: GOOD_PASSWORD, confirm: GOOD_PASSWORD, token: lastLinkSecret() }),
  );
  expect(done).toEqual({ done: true });
  return user;
}

/** A session cookie for the person, as the sign-in screen leaves it in the browser. */
async function sessionCookie(email: string): Promise<string> {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: GOOD_PASSWORD },
    headers: new Headers({ 'x-forwarded-for': address(), [TURNSTILE_HEADER]: 'ok' }),
    returnHeaders: true,
  });
  return cookieHeader(headers);
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

describe('requestNewPassword and setPassword', () => {
  it('refuses a check the person did not pass, and answers the same for anyone else', async () => {
    const refused = await requestNewPassword(
      {},
      form({ email: 'nobody@shakti.test', 'cf-turnstile-response': 'no' }),
    );
    expect(refused.error).toBe('bot_check_failed');
    expect(refused.done).toBeUndefined();
    // An address with no account gets the same answer, so the screen reveals nothing.
    await expect(
      requestNewPassword(
        {},
        form({ email: 'nobody@shakti.test', 'cf-turnstile-response': 'ok:reset' }),
      ),
    ).resolves.toEqual({ done: true });
  });

  it('refuses a password the person did not repeat, a short one and a stale link', async () => {
    await expect(
      setPassword({}, form({ password: GOOD_PASSWORD, confirm: 'other', token: 'x' })),
    ).resolves.toEqual({ error: 'password_mismatch', field: 'confirm' });
    await expect(
      setPassword({}, form({ password: 'short', confirm: 'short', token: 'x' })),
    ).resolves.toEqual({ error: 'password_too_short', field: 'password' });
    await expect(
      setPassword(
        {},
        form({ password: GOOD_PASSWORD, confirm: GOOD_PASSWORD, token: 'not-a-link' }),
      ),
    ).resolves.toEqual({ error: 'link_expired' });
  });

  it('sets the password from the emailed link', async () => {
    await personWithPassword('tele_caller_cc');
  });
});

describe('signIn and signOut', () => {
  it('refuses a wrong password with a sentence, not a thrown error', async () => {
    const user = await personWithPassword('tele_caller_cc');
    await expect(
      signIn(
        {},
        form({ email: user.email, password: 'not the password', 'cf-turnstile-response': 'ok' }),
      ),
    ).resolves.toEqual({ error: 'sign_in_failed' });
  });

  it('signs in, forgets the company chosen before and opens Home', async () => {
    const user = await personWithPassword('tele_caller_cc');
    request.jar.set('entity', '2');
    await expect(
      signIn(
        {},
        form({ email: user.email, password: GOOD_PASSWORD, 'cf-turnstile-response': 'ok' }),
      ),
    ).rejects.toThrow('redirect /home');
    expect(request.jar.has('entity')).toBe(false);
  });

  it('signs out, and an already-ended session signs out all the same', async () => {
    const user = await personWithPassword('tele_caller_cc');
    const cookie = await sessionCookie(user.email);
    setRequest(cookie);
    request.jar.set('entity', '1');
    await expect(signOut()).rejects.toThrow('redirect /sign-in');
    expect(request.jar.has('entity')).toBe(false);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    await expect(signOut()).rejects.toThrow('redirect /sign-in');
  });
});

describe('changePassword', () => {
  it('refuses a repeat that differs, nobody signed in and a wrong current password', async () => {
    const fields = { currentPassword: GOOD_PASSWORD, newPassword: 'kharif sowing 2027 canal' };
    await expect(changePassword({}, form({ ...fields, confirm: 'other' }))).resolves.toEqual({
      error: 'password_mismatch',
      field: 'confirm',
    });
    await expect(
      changePassword({}, form({ ...fields, confirm: fields.newPassword })),
    ).resolves.toEqual({ error: 'unauthorized' });

    const user = await personWithPassword('tele_caller_cc');
    setRequest(await sessionCookie(user.email));
    await expect(
      changePassword(
        {},
        form({ ...fields, currentPassword: 'not the password', confirm: fields.newPassword }),
      ),
    ).resolves.toEqual({ error: 'password_incorrect', field: 'currentPassword' });
  });

  it('changes the password of the person signed in', async () => {
    const user = await personWithPassword('tele_caller_cc');
    setRequest(await sessionCookie(user.email));
    const next = 'kharif sowing 2027 canal';
    await expect(
      changePassword(
        {},
        form({ currentPassword: GOOD_PASSWORD, newPassword: next, confirm: next }),
      ),
    ).resolves.toEqual({ done: true });
  });
});

describe('the authenticator app and backup codes', () => {
  it('refuses to begin without a session or the right password, and a code before setup', async () => {
    await expect(beginTwoFactor({}, form({ password: GOOD_PASSWORD }))).resolves.toEqual({
      error: 'unauthorized',
    });
    const user = await personWithPassword('accounts');
    setRequest(await sessionCookie(user.email));
    await expect(beginTwoFactor({}, form({ password: 'not the password' }))).resolves.toMatchObject(
      { error: 'password_incorrect' },
    );
    await expect(verifyTwoFactor({}, form({ code: '000000' }))).resolves.toEqual({
      error: 'authenticator_missing',
    });
  });

  it('sets up the app, confirms it with a code, then signs in with a backup code', async () => {
    const user = await personWithPassword('accounts');
    const cookie = await sessionCookie(user.email);
    setRequest(cookie);
    const begun = await beginTwoFactor({}, form({ password: GOOD_PASSWORD }));
    expect(begun.error).toBeUndefined();
    expect(begun.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(begun.backupCodes).toHaveLength(10);
    const secret = begun.manualKey ?? '';
    expect(secret).not.toBe('');

    setRequest(cookie);
    await expect(verifyTwoFactor({}, form({ code: '000000' }))).resolves.toEqual({
      error: 'code_incorrect',
    });
    // Typed with a space, as people copy it from the app; the enrolment then opens Home.
    await expect(
      verifyTwoFactor({}, form({ code: totpCode(secret, new Date()).replace(/^(\d{3})/, '$1 ') })),
    ).rejects.toThrow('redirect /home');

    // The next sign-in asks for the second step; a backup code answers it once.
    const { headers, response } = await auth.api.signInEmail({
      body: { email: user.email, password: GOOD_PASSWORD },
      headers: new Headers({ 'x-forwarded-for': address(), [TURNSTILE_HEADER]: 'ok' }),
      returnHeaders: true,
    });
    expect(response).toMatchObject({ twoFactorRedirect: true });
    setRequest(cookieHeader(headers));
    await expect(verifyBackupCode({}, form({ code: 'not-a-code' }))).resolves.toEqual({
      error: 'backup_code_incorrect',
    });
    await expect(
      verifyBackupCode({}, form({ code: begun.backupCodes?.[0] ?? '' })),
    ).rejects.toThrow('redirect /home');
  });
});
