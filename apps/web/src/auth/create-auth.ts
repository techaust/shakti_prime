import { hash, verify } from '@node-rs/argon2';
import {
  newId,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
} from '@shakti/contracts';
import { authDb, authSchema } from '@shakti/db/auth';
import { createLockout } from '@shakti/domain';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { haveIBeenPwned, twoFactor } from 'better-auth/plugins';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthDeps } from './deps';
import { mailTranslator } from './mail-copy';
import { TURNSTILE_HEADER, verifyTurnstile } from './turnstile';

/** Argon2id parameters from docs/SECURITY.md §2: m = 64 MiB, t = 3, p = 1. */
// algorithm 2 is Argon2id in @node-rs/argon2 (a const enum, not importable under verbatimModuleSyntax).
const ARGON2 = { memoryCost: 64 * 1024, timeCost: 3, parallelism: 1, algorithm: 2 as const };

/** Invite and reset links stay valid for a day; a used token is deleted. */
const RESET_TOKEN_SECONDS = 24 * 60 * 60;

/** Paths guarded by Turnstile and the lockout. */
const SIGN_IN_PATH = '/sign-in/email';
const RESET_REQUEST_PATH = '/request-password-reset';
const SIGN_OUT_PATH = '/sign-out';

/**
 * Paths that neither read nor need the current session. A browser still holding the cookie of a
 * session the app has ended must be able to sign in or set a password again, rather than be
 * refused until the cookie expires (AUDIT H1). Route templates, as Better Auth reports ctx.path.
 */
const SESSION_FREE_PATHS: ReadonlySet<string> = new Set([
  SIGN_OUT_PATH,
  SIGN_IN_PATH,
  RESET_REQUEST_PATH,
  '/reset-password',
  '/reset-password/:token',
]);

/** Our own error codes on top of Better Auth's; the actions map them to catalogue keys. */
export const AUTH_ERROR_CODES = {
  BOT_CHECK_FAILED: 'BOT_CHECK_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  TRUSTED_DEVICE_OFF: 'TRUSTED_DEVICE_OFF',
} as const;

/**
 * Per-path request caps per client address on top of the lockout (docs/SECURITY.md §2). Sign-in
 * has its own exponential lockout; these bound the other password-hashing and mail-sending
 * endpoints. Applied in the before hook, so they hold for the HTTP routes and for the server
 * actions that call the API in-process alike; Better Auth's own limiter adds a global cap on HTTP.
 */
const RATE_LIMIT_RULES: Record<string, { window: number; max: number }> = {
  [RESET_REQUEST_PATH]: { window: 15 * 60, max: 3 },
  '/reset-password': { window: 15 * 60, max: 5 },
  '/change-password': { window: 60, max: 5 },
  '/verify-password': { window: 60, max: 5 },
  '/two-factor/enable': { window: 60, max: 5 },
  '/two-factor/disable': { window: 60, max: 5 },
};

function clientIp(headers: Headers | undefined): string | undefined {
  const forwarded = headers?.get('x-forwarded-for');
  if (forwarded !== null && forwarded !== undefined && forwarded !== '') {
    return forwarded.split(',')[0]?.trim();
  }
  const real = headers?.get('x-real-ip');
  return real === null || real === '' ? undefined : real;
}

function lockoutKeys(email: unknown, ip: string | undefined): string[] {
  const keys: string[] = [];
  if (typeof email === 'string' && email !== '') keys.push(`acct:${email.trim().toLowerCase()}`);
  if (ip !== undefined) keys.push(`ip:${ip}`);
  return keys;
}

/**
 * A wrong-password answer for an inactive account costs the same as for an active one, so the
 * response time does not say which accounts exist and are suspended.
 */
let dummyHash: Promise<string> | undefined;
async function spendPasswordVerify(password: unknown): Promise<void> {
  dummyHash ??= hash('not a real password', ARGON2);
  await verify(await dummyHash, typeof password === 'string' ? password : '');
}

export interface CreateAuthOptions {
  /** Off for scripts and tests that run outside a Next.js request. */
  nextCookies?: boolean;
  baseURL?: string;
  secret?: string;
  /** Defaults to production. `__Host-` session cookie, `Secure` on every cookie. */
  secureCookies?: boolean;
  /** Defaults to production. Tests switch it on to prove the caps. */
  rateLimit?: boolean;
}

/**
 * The Better Auth instance (docs/design/backend-weeks-3-5.md §2.2): email and password with
 * Argon2id, the breached-password check, Turnstile and exponential lockouts on sign-in, sessions
 * with a 12 h idle limit and the 7 d absolute limit, TOTP with backup codes and no trusted
 * devices, and invites through the password-reset flow. No self sign-up. A session the app has
 * revoked (admin, role change, suspension, expiry) is refused on every route, not only in
 * `currentPrincipal()`.
 */
export function createAuth(deps: AuthDeps, options: CreateAuthOptions = {}) {
  const lockout = createLockout(deps.keyValue, () => deps.now().getTime());
  const production = process.env.NODE_ENV === 'production';
  const secure = options.secureCookies ?? production;

  /** Fixed-window cap per path and address, counted in the shared store. */
  async function applyRequestCap(path: string, ip: string | undefined): Promise<void> {
    const rule = RATE_LIMIT_RULES[path];
    if (rule === undefined || ip === undefined || !(options.rateLimit ?? production)) return;
    const count = await deps.keyValue.incr(`cap:${path}:${ip}`, rule.window);
    if (count > rule.max) {
      throw new APIError(
        'TOO_MANY_REQUESTS',
        { message: 'too many requests', code: AUTH_ERROR_CODES.ACCOUNT_LOCKED },
        { 'Retry-After': String(rule.window) },
      );
    }
  }

  /** Throws when the request's session cookie names a session the app has ended. */
  async function refuseRevokedSession(
    ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  ) {
    if (ctx.headers === undefined || SESSION_FREE_PATHS.has(ctx.path)) return;
    const session = await getSessionFromCtx(ctx).catch(() => null);
    if (!session) return;
    const s = authSchema.sessions;
    const [row] = await authDb()
      .select({ revokedAt: s.revokedAt, createdAt: s.createdAt })
      .from(s)
      .where(eq(s.id, session.session.id))
      .limit(1);
    if (!row) return;
    const now = deps.now();
    const tooOld = now.getTime() - row.createdAt.getTime() > SESSION_ABSOLUTE_SECONDS * 1000;
    if (row.revokedAt === null && tooOld) {
      // Recorded once, so the sessions screen shows why it ended (docs/SECURITY.md §2).
      await authDb()
        .update(s)
        .set({ revokedAt: now, revokedReason: 'absolute_expiry' })
        .where(and(eq(s.id, session.session.id), isNull(s.revokedAt)));
    }
    if (row.revokedAt !== null || tooOld) {
      throw new APIError('UNAUTHORIZED', { message: 'session ended', code: 'SESSION_EXPIRED' });
    }
  }

  return betterAuth({
    appName: 'Shakti Prime',
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(authDb(), { provider: 'pg', schema: authSchema }),
    user: {
      modelName: 'users',
      additionalFields: {
        phone: { type: 'string', required: false, input: false },
        theme: { type: 'string', required: false, input: false, defaultValue: 'system' },
        status: { type: 'string', required: false, input: false, defaultValue: 'invited' },
        lastLoginAt: { type: 'date', required: false, input: false },
      },
    },
    session: {
      modelName: 'sessions',
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: 5 * 60,
      additionalFields: {
        lastSeenAt: { type: 'date', required: false, input: false },
        revokedAt: { type: 'date', required: false, input: false },
        revokedReason: { type: 'string', required: false, input: false },
      },
    },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verifications' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
      // The first password set through an invite link activates the user.
      onPasswordReset: async ({ user }) => {
        await authDb()
          .update(authSchema.users)
          .set({ status: 'active', emailVerified: true })
          .where(and(eq(authSchema.users.id, user.id), eq(authSchema.users.status, 'invited')));
      },
      sendResetPassword: async ({ user, url }) => {
        const t = mailTranslator();
        await deps.mailer.send({
          to: user.email,
          subject: t('setPassword.subject'),
          text: t('setPassword.body', { name: user.name, url }),
        });
      },
    },
    rateLimit: {
      enabled: options.rateLimit ?? production,
      window: 60,
      max: 60,
      customRules: RATE_LIMIT_RULES,
      // The shared store, so the caps hold across function instances (fixed window per key).
      customStorage: {
        consume: async (key, rule) => {
          const count = await deps.keyValue.incr(`ratelimit:${key}`, rule.window);
          return count <= rule.max
            ? { allowed: true, retryAfter: null }
            : { allowed: false, retryAfter: rule.window };
        },
      },
    },
    advanced: {
      database: { generateId: () => newId() },
      // Better Auth prefixes every name with `__Secure-` when useSecureCookies is on, which would
      // turn the `__Host-` session cookie into `__Secure-__Host-…`; the attributes are set by hand.
      useSecureCookies: false,
      defaultCookieAttributes: { secure, sameSite: 'lax', httpOnly: true, path: '/' },
      cookiePrefix: 'shakti',
      cookies: secure
        ? { session_token: { name: '__Host-shakti-session', attributes: { path: '/' } } }
        : {},
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await refuseRevokedSession(ctx);
        await applyRequestCap(ctx.path, clientIp(ctx.headers));
        if (ctx.path.startsWith('/two-factor/verify-')) {
          const body = ctx.body as { trustDevice?: unknown } | undefined;
          if (body?.trustDevice === true) {
            throw new APIError('BAD_REQUEST', {
              message: 'trusted devices are off: a code is asked at every sign-in',
              code: AUTH_ERROR_CODES.TRUSTED_DEVICE_OFF,
            });
          }
        }
        if (ctx.path !== SIGN_IN_PATH && ctx.path !== RESET_REQUEST_PATH) return;
        // A call without headers comes from our own server code (an invite), never from a client.
        if (ctx.headers === undefined) return;
        const ip = clientIp(ctx.headers);
        const human = await verifyTurnstile(ctx.headers.get(TURNSTILE_HEADER), {
          secretKey: deps.turnstileSecretKey,
          remoteIp: ip,
          fetch: deps.fetch,
        });
        if (!human) {
          throw new APIError('BAD_REQUEST', {
            message: 'bot check failed',
            code: AUTH_ERROR_CODES.BOT_CHECK_FAILED,
          });
        }
        if (ctx.path !== SIGN_IN_PATH) return;
        const body = ctx.body as { email?: unknown; password?: unknown } | undefined;
        try {
          await lockout.check(lockoutKeys(body?.email, ip));
        } catch (e) {
          const retryAfter =
            typeof e === 'object' && e !== null && 'details' in e
              ? (e as { details?: { retryAfterSeconds?: number } }).details?.retryAfterSeconds
              : undefined;
          throw new APIError(
            'TOO_MANY_REQUESTS',
            { message: 'account locked', code: AUTH_ERROR_CODES.ACCOUNT_LOCKED },
            retryAfter === undefined ? undefined : { 'Retry-After': String(retryAfter) },
          );
        }
        // A suspended or offboarded user gets the same answer, and the same delay, as a wrong password.
        if (typeof body?.email === 'string') {
          const [row] = await authDb()
            .select({ status: authSchema.users.status })
            .from(authSchema.users)
            .where(eq(authSchema.users.email, body.email.trim().toLowerCase()))
            .limit(1);
          if (row && row.status !== 'active' && row.status !== 'invited') {
            await spendPasswordVerify(body.password);
            throw new APIError('UNAUTHORIZED', {
              message: 'account not active',
              code: 'INVALID_EMAIL_OR_PASSWORD',
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned: unknown = ctx.context.returned;
        const failed = returned instanceof APIError;
        if (ctx.path === SIGN_IN_PATH) {
          const body = ctx.body as { email?: unknown } | undefined;
          const keys = lockoutKeys(body?.email, clientIp(ctx.headers));
          if (failed) {
            if (returned.statusCode === 401) await lockout.recordFailure(keys);
            return;
          }
          await lockout.reset(keys);
          if (typeof body?.email === 'string') {
            await authDb()
              .update(authSchema.users)
              .set({ lastLoginAt: deps.now() })
              .where(eq(authSchema.users.email, body.email.trim().toLowerCase()));
          }
          return;
        }
      }),
    },
    plugins: [
      twoFactor({
        issuer: 'Shakti Prime',
        schema: { twoFactor: { modelName: 'user_two_factor' } },
      }),
      haveIBeenPwned(),
      ...(options.nextCookies === false ? [] : [nextCookies()]),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
