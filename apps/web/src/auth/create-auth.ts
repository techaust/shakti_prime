import { hash, verify } from '@node-rs/argon2';
import {
  newId,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
} from '@shakti/contracts';
import { authDb, authSchema } from '@shakti/db/auth';
import { createSignInGuard } from '@shakti/domain';
import { logger as appLogger } from '../log';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getIP, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { haveIBeenPwned, twoFactor } from 'better-auth/plugins';
import { and, eq, isNull, like, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { generateBackupCodes } from './backup-codes';
import type { AuthDeps } from './deps';
import { mailTranslator } from './mail-copy';
import {
  TURNSTILE_HEADER,
  TURNSTILE_RESET_ACTION,
  TURNSTILE_SIGN_IN_ACTION,
  verifyTurnstile,
} from './turnstile';

/** Argon2id parameters from docs/SECURITY.md §2: m = 64 MiB, t = 3, p = 1. */
// algorithm 2 is Argon2id in @node-rs/argon2 (a const enum, not importable under verbatimModuleSyntax).
const ARGON2 = { memoryCost: 64 * 1024, timeCost: 3, parallelism: 1, algorithm: 2 as const };

/** A forgotten-password link lasts an hour; a first invitation a day (AUDIT M7). */
const RESET_LINK_SECONDS = 60 * 60;
const INVITE_LINK_SECONDS = 24 * 60 * 60;
const RESET_PREFIX = 'reset-password:';

/** Paths guarded by Turnstile and the lockout. */
const SIGN_IN_PATH = '/sign-in/email';
const RESET_REQUEST_PATH = '/request-password-reset';
const RESET_PATH = '/reset-password';
const SIGN_OUT_PATH = '/sign-out';
const VERIFY_TOTP_PATH = '/two-factor/verify-totp';
const VERIFY_BACKUP_PATH = '/two-factor/verify-backup-code';

/**
 * Paths that neither read nor need the current session. A browser still holding the cookie of a
 * session the app has ended must be able to sign in or set a password again, rather than be
 * refused until the cookie expires (AUDIT H1). Route templates, as Better Auth reports ctx.path.
 */
const SESSION_FREE_PATHS: ReadonlySet<string> = new Set([
  SIGN_OUT_PATH,
  SIGN_IN_PATH,
  RESET_REQUEST_PATH,
  RESET_PATH,
  '/reset-password/:token',
]);

/**
 * Better Auth endpoints no screen calls over HTTP (AUDIT M4). The screens reach the auth module
 * through server actions, which call the API in-process, so only the link a set-password email
 * opens (`/reset-password/:token`) is served over HTTP. `disabledPaths` applies to HTTP only.
 * `auth.test.ts` checks this list against every endpoint the installed version mounts.
 */
export const HTTP_DISABLED_PATHS = [
  '/sign-in/email',
  '/sign-up/email',
  '/sign-out',
  '/get-session',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/update-session',
  '/update-user',
  '/delete-user',
  '/delete-user/callback',
  '/change-email',
  '/change-password',
  '/set-password',
  '/verify-password',
  '/request-password-reset',
  '/reset-password',
  '/verify-email',
  '/send-verification-email',
  '/list-accounts',
  '/account-info',
  '/link-social',
  '/unlink-account',
  '/refresh-token',
  '/get-access-token',
  '/sign-in/social',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/get-totp-uri',
  '/two-factor/generate-backup-codes',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
];

/** Our own error codes on top of Better Auth's; the actions map them to catalogue keys. */
export const AUTH_ERROR_CODES = {
  BOT_CHECK_FAILED: 'BOT_CHECK_FAILED',
  BOT_CHECK_UNAVAILABLE: 'BOT_CHECK_UNAVAILABLE',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  TRUSTED_DEVICE_OFF: 'TRUSTED_DEVICE_OFF',
} as const;

/**
 * Per-path request caps per client address (docs/SECURITY.md §2). They bound what one address
 * can try across accounts, now that the sign-in lock applies to one account from one address
 * (AUDIT M6), and they bound the password-hashing and mail-sending endpoints. Applied in the
 * before hook, so they hold for the HTTP routes and for in-process calls alike. The set-password
 * cap is also counted per link (AUDIT M27), so one office can onboard a whole team.
 */
const RATE_LIMIT_RULES: Record<string, { window: number; max: number }> = {
  [SIGN_IN_PATH]: { window: 15 * 60, max: 100 },
  [RESET_REQUEST_PATH]: { window: 15 * 60, max: 3 },
  [RESET_PATH]: { window: 15 * 60, max: 30 },
  '/change-password': { window: 60, max: 5 },
  '/verify-password': { window: 60, max: 5 },
  '/two-factor/enable': { window: 60, max: 5 },
  '/two-factor/disable': { window: 60, max: 5 },
};
const RESET_PER_LINK = { window: 15 * 60, max: 5 };

/** A second-factor code verifies once: long enough to cover the ±1 step Better Auth accepts. */
const USED_CODE_SECONDS = 120;

/**
 * Better Auth options that also drive our own address resolution, so the lockout, the caps and
 * the session record agree on one client address (AUDIT L20). On Vercel the edge overwrites
 * `X-Forwarded-For` with the connecting address, so a single value there is trustworthy; IPv6
 * addresses are grouped by /64, as one household or phone gets a whole /64.
 */
const ADDRESS_OPTIONS = {
  advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'], ipv6Subnet: 64 } },
} satisfies Pick<BetterAuthOptions, 'advanced'>;

function clientAddress(headers: Headers | undefined): string | undefined {
  if (headers === undefined) return undefined;
  return getIP(headers, ADDRESS_OPTIONS) ?? undefined;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

/**
 * Verification identifiers are stored hashed (AUDIT M7): a copy of the table or a backup does
 * not hold usable links. Set-password links keep their prefix so one person's earlier links can
 * be found and withdrawn when a new one is sent.
 */
function hashIdentifier(identifier: string): string {
  const digest = sha256(identifier);
  return identifier.startsWith(RESET_PREFIX) ? `${RESET_PREFIX}${digest}` : digest;
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

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['active', 'invited']);

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
 * Argon2id, the breached-password check, Turnstile and the sign-in lockout, sessions with a 12 h
 * idle limit and the 7 d absolute limit, TOTP with backup codes, no trusted devices and no reused
 * codes, and invites through the password-reset flow. No self sign-up. A session the app has
 * revoked (admin, role change, suspension, expiry) is refused on every route, not only in
 * `currentPrincipal()`, and no session is created for an inactive user.
 */
export function createAuth(deps: AuthDeps, options: CreateAuthOptions = {}) {
  const guard = createSignInGuard(deps.keyValue, () => deps.now().getTime());
  const log = deps.logger ?? appLogger;
  const production = process.env.NODE_ENV === 'production';
  const secure = options.secureCookies ?? production;
  const capsOn = options.rateLimit ?? production;

  const tooMany = (retryAfter: number | undefined) =>
    new APIError(
      'TOO_MANY_REQUESTS',
      { message: 'too many requests', code: AUTH_ERROR_CODES.ACCOUNT_LOCKED },
      retryAfter === undefined ? undefined : { 'Retry-After': String(retryAfter) },
    );

  /** Fixed-window cap per key, counted in the shared store. */
  async function cap(key: string, rule: { window: number; max: number }): Promise<void> {
    if (!capsOn) return;
    const count = await deps.keyValue.incr(`cap:${key}`, rule.window);
    if (count > rule.max) throw tooMany(rule.window);
  }

  async function applyRequestCaps(
    path: string,
    address: string | undefined,
    body: unknown,
  ): Promise<void> {
    const rule = RATE_LIMIT_RULES[path];
    if (rule !== undefined && address !== undefined) await cap(`${path}:${address}`, rule);
    if (path === RESET_PATH) {
      const token = (body as { token?: unknown } | undefined)?.token;
      if (typeof token === 'string') await cap(`${path}:link:${sha256(token)}`, RESET_PER_LINK);
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

  /**
   * The user a second-factor request is for: the signed-in user while enrolling, otherwise the
   * one named by the pending sign-in's two-factor cookie.
   */
  async function secondFactorUserId(
    ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  ): Promise<string | undefined> {
    const session = await getSessionFromCtx(ctx).catch(() => null);
    if (session) return session.user.id;
    const cookie = ctx.context.createAuthCookie('two_factor');
    const pending = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (typeof pending !== 'string' || pending === '') return undefined;
    const found = await ctx.context.internalAdapter.findVerificationValue(pending);
    return found?.value;
  }

  /** A code is spent by its first use, right or wrong, for as long as it could verify (AUDIT M5). */
  async function refuseReusedCode(
    ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  ): Promise<void> {
    const code = (ctx.body as { code?: unknown } | undefined)?.code;
    if (typeof code !== 'string') return;
    const userId = await secondFactorUserId(ctx);
    if (userId === undefined) return;
    const uses = await deps.keyValue.incr(`totp-used:${userId}:${code}`, USED_CODE_SECONDS);
    if (uses > 1) {
      throw new APIError('UNAUTHORIZED', { message: 'code already used', code: 'INVALID_CODE' });
    }
  }

  async function userByEmail(email: string) {
    const u = authSchema.users;
    const [row] = await authDb()
      .select({
        id: u.id,
        name: u.name,
        email: u.email,
        status: u.status,
        twoFactorEnabled: u.twoFactorEnabled,
      })
      .from(u)
      .where(eq(u.email, email.trim().toLowerCase()))
      .limit(1);
    return row;
  }

  /** A wrong password: lengthen the lock, and tell the owner at every tenth failure. */
  async function recordSignInFailure(email: string, address: string | undefined): Promise<void> {
    const { notify } = await guard.recordFailure(email, address);
    if (!notify) return;
    const user = await userByEmail(email);
    if (user === undefined || !ACTIVE_STATUSES.has(user.status)) return;
    const t = mailTranslator();
    await deps.mailer.send({
      to: user.email,
      subject: t('signInAttempts.subject'),
      text: t('signInAttempts.body', { name: user.name }),
    });
  }

  /** A sign-in is complete once the second factor is done, where there is one (AUDIT M5). */
  async function completeSignIn(
    user: { id: string; email: string },
    address: string | undefined,
  ): Promise<void> {
    await guard.succeeded(user.email, address);
    await authDb()
      .update(authSchema.users)
      .set({ lastLoginAt: deps.now() })
      .where(eq(authSchema.users.id, user.id));
  }

  return betterAuth({
    appName: 'Shakti Prime',
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(authDb(), { provider: 'pg', schema: authSchema }),
    disabledPaths: HTTP_DISABLED_PATHS,
    // Better Auth's own messages and HTTP failures go through the redacting logger: its default
    // logger prints a failed query with its bound values, set-password links included (AUDIT M10).
    logger: {
      level: 'warn',
      log: (level, message, ...args) => {
        log.log(level, 'auth.library', { message, args });
      },
    },
    onAPIError: {
      onError: (error) => {
        const status = error instanceof APIError ? error.statusCode : 500;
        if (status >= 500) log.log('error', 'auth.http_failed', { error });
      },
    },
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
    verification: {
      modelName: 'auth_verifications',
      storeIdentifier: { hash: (identifier) => Promise.resolve(hashIdentifier(identifier)) },
    },
    databaseHooks: {
      session: {
        create: {
          // A user suspended between the password and the second factor gets no session (AUDIT L21).
          before: async (session) => {
            const u = authSchema.users;
            const [row] = await authDb()
              .select({ status: u.status })
              .from(u)
              .where(eq(u.id, session.userId))
              .limit(1);
            return row !== undefined && ACTIVE_STATUSES.has(row.status) ? undefined : false;
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
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
      sendResetPassword: async ({ user, url, token }) => {
        const v = authSchema.auth_verifications;
        const identifier = hashIdentifier(`${RESET_PREFIX}${token}`);
        // One live link per person: a new link withdraws the earlier ones (AUDIT M7).
        await authDb()
          .delete(v)
          .where(
            and(
              eq(v.value, user.id),
              like(v.identifier, `${RESET_PREFIX}%`),
              ne(v.identifier, identifier),
            ),
          );
        const invited = (user as { status?: unknown }).status === 'invited';
        if (invited) {
          // Better Auth checks link expiry against the real clock, so this does too.
          await authDb()
            .update(v)
            .set({ expiresAt: new Date(Date.now() + INVITE_LINK_SECONDS * 1000) })
            .where(eq(v.identifier, identifier));
        }
        const t = mailTranslator();
        const kind = invited ? 'setPassword' : 'resetPassword';
        try {
          await deps.mailer.send({
            to: user.email,
            subject: t(`${kind}.subject`),
            text: t(`${kind}.body`, { name: user.name, url }),
          });
        } catch (error) {
          // Better Auth logs and swallows a failed send, so the invite action could not tell
          // the Executive; the failure is recorded for it to read (AUDIT M26).
          log.log('error', 'auth.mail_failed', { kind, error });
          await deps.keyValue.set(mailFailedKey(user.id), '1', MAIL_FAILED_SECONDS);
          throw error;
        }
      },
    },
    rateLimit: {
      enabled: capsOn,
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
      ...ADDRESS_OPTIONS.advanced,
      database: { generateId: () => newId() },
      // Better Auth prefixes every name with `__Secure-` when useSecureCookies is on, which would
      // turn the `__Host-` session cookie into `__Secure-__Host-…`; the attributes are set by hand.
      useSecureCookies: false,
      defaultCookieAttributes: { secure, sameSite: 'lax', httpOnly: true, path: '/' },
      cookiePrefix: 'shakti',
      cookies: secure
        ? { session_token: { name: '__Host-shakti-session', attributes: { path: '/' } } }
        : {},
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await refuseRevokedSession(ctx);
        const address = clientAddress(ctx.headers);
        await applyRequestCaps(ctx.path, address, ctx.body);
        if (ctx.path === VERIFY_TOTP_PATH || ctx.path === VERIFY_BACKUP_PATH) {
          const body = ctx.body as { trustDevice?: unknown } | undefined;
          if (body?.trustDevice === true) {
            throw new APIError('BAD_REQUEST', {
              message: 'trusted devices are off: a code is asked at every sign-in',
              code: AUTH_ERROR_CODES.TRUSTED_DEVICE_OFF,
            });
          }
          if (ctx.path === VERIFY_TOTP_PATH) await refuseReusedCode(ctx);
        }
        if (ctx.path !== SIGN_IN_PATH && ctx.path !== RESET_REQUEST_PATH) return;
        // A call without headers comes from our own server code (an invite), never from a client.
        if (ctx.headers === undefined) return;
        const verdict = await verifyTurnstile(ctx.headers.get(TURNSTILE_HEADER), {
          secretKey: deps.turnstileSecretKey,
          remoteIp: address,
          fetch: deps.fetch,
          expectedHostname: deps.turnstileHostname,
          expectedAction:
            ctx.path === SIGN_IN_PATH ? TURNSTILE_SIGN_IN_ACTION : TURNSTILE_RESET_ACTION,
          logger: log,
        });
        if (verdict === 'unavailable') {
          throw new APIError('SERVICE_UNAVAILABLE', {
            message: 'bot check unavailable',
            code: AUTH_ERROR_CODES.BOT_CHECK_UNAVAILABLE,
          });
        }
        if (verdict !== 'human') {
          throw new APIError('BAD_REQUEST', {
            message: 'bot check failed',
            code: AUTH_ERROR_CODES.BOT_CHECK_FAILED,
          });
        }
        if (ctx.path !== SIGN_IN_PATH) return;
        const body = ctx.body as { email?: unknown; password?: unknown } | undefined;
        if (typeof body?.email !== 'string' || body.email === '') return;
        const email = body.email;
        try {
          await guard.check(email, address);
        } catch (e) {
          const retryAfter =
            typeof e === 'object' && e !== null && 'details' in e
              ? (e as { details?: { retryAfterSeconds?: number } }).details?.retryAfterSeconds
              : undefined;
          throw tooMany(retryAfter);
        }
        // A suspended or offboarded user gets the same answer, delay and lock as a wrong
        // password, so the lock does not reveal which accounts are inactive (AUDIT L21).
        const user = await userByEmail(email);
        if (user && !ACTIVE_STATUSES.has(user.status)) {
          await spendPasswordVerify(body.password);
          await recordSignInFailure(email, address);
          throw new APIError('UNAUTHORIZED', {
            message: 'account not active',
            code: 'INVALID_EMAIL_OR_PASSWORD',
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned: unknown = ctx.context.returned;
        const failed = returned instanceof APIError;
        const address = clientAddress(ctx.headers);
        if (ctx.path === SIGN_IN_PATH) {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email !== 'string' || email === '') return;
          if (failed) {
            if (returned.statusCode === 401) await recordSignInFailure(email, address);
            return;
          }
          // This hook runs before the two-factor plugin turns the answer into a code request,
          // so the user's own setting says whether the sign-in is complete yet.
          const user = await userByEmail(email);
          if (user && !user.twoFactorEnabled) await completeSignIn(user, address);
          return;
        }
        if ((ctx.path === VERIFY_TOTP_PATH || ctx.path === VERIFY_BACKUP_PATH) && !failed) {
          const user = ctx.context.newSession?.user;
          if (user) await completeSignIn({ id: user.id, email: user.email }, address);
        }
      }),
    },
    plugins: [
      twoFactor({
        issuer: 'Shakti Prime',
        schema: { twoFactor: { modelName: 'user_two_factor' } },
        // Five wrong codes lock the second factor for an hour (AUDIT M5).
        accountLockout: { maxFailedAttempts: 5, durationSeconds: 60 * 60 },
        // Readable codes, and the action brings what is typed to their form (AUDIT M51).
        backupCodeOptions: { customBackupCodesGenerate: generateBackupCodes },
      }),
      haveIBeenPwned(),
      ...(options.nextCookies === false ? [] : [nextCookies()]),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const MAIL_FAILED_SECONDS = 5 * 60;
const mailFailedKey = (userId: string) => `mail-failed:${userId}`;

/** True, once, when the last set-password mail to this user failed to go out (AUDIT M26). */
export async function setPasswordMailFailed(
  deps: Pick<AuthDeps, 'keyValue'>,
  userId: string,
): Promise<boolean> {
  const key = mailFailedKey(userId);
  const failed = (await deps.keyValue.get(key)) !== null;
  if (failed) await deps.keyValue.del(key);
  return failed;
}

/** Lifts every sign-in lock on an account (AUDIT M6); the admin action checks the permission. */
export function clearSignInLock(deps: Pick<AuthDeps, 'keyValue' | 'now'>, email: string) {
  return createSignInGuard(deps.keyValue, () => deps.now().getTime()).clear(email);
}
