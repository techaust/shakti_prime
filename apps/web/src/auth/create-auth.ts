import { hash, verify } from '@node-rs/argon2';
import {
  newId,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_IDLE_SECONDS,
} from '@shakti/contracts';
import { authDb, authSchema } from '@shakti/db/auth';
import { createLockout } from '@shakti/domain';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { haveIBeenPwned, twoFactor } from 'better-auth/plugins';
import { and, eq } from 'drizzle-orm';
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

/** Our own error codes on top of Better Auth's; the actions map them to catalogue keys. */
export const AUTH_ERROR_CODES = {
  BOT_CHECK_FAILED: 'BOT_CHECK_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
} as const;

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

export interface CreateAuthOptions {
  /** Off for scripts and tests that run outside a Next.js request. */
  nextCookies?: boolean;
  baseURL?: string;
  secret?: string;
}

/**
 * The Better Auth instance (docs/design/backend-weeks-3-5.md §2.2): email and password with
 * Argon2id, the breached-password check, Turnstile and exponential lockouts on sign-in, sessions
 * with a 12 h idle limit (the 7 d absolute limit is enforced in current-principal.ts), TOTP with
 * backup codes, and invites through the password-reset flow. No self sign-up.
 */
export function createAuth(deps: AuthDeps, options: CreateAuthOptions = {}) {
  const lockout = createLockout(deps.keyValue, () => deps.now().getTime());
  const secure = process.env.NODE_ENV === 'production';

  return betterAuth({
    appName: 'Shakti Prime',
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(authDb(), { provider: 'pg', schema: authSchema }),
    user: {
      modelName: 'users',
      additionalFields: {
        phone: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, input: false, defaultValue: 'en' },
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
        const t = mailTranslator((user as { locale?: unknown }).locale);
        await deps.mailer.send({
          to: user.email,
          subject: t('setPassword.subject'),
          text: t('setPassword.body', { name: user.name, url }),
        });
      },
    },
    rateLimit: { enabled: false },
    advanced: {
      database: { generateId: () => newId() },
      useSecureCookies: secure,
      cookiePrefix: 'shakti',
      cookies: secure
        ? { session_token: { name: '__Host-shakti-session', attributes: { path: '/' } } }
        : {},
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
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
        const body = ctx.body as { email?: unknown } | undefined;
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
        // A suspended or offboarded user gets the same answer as a wrong password.
        if (typeof body?.email === 'string') {
          const [row] = await authDb()
            .select({ status: authSchema.users.status })
            .from(authSchema.users)
            .where(eq(authSchema.users.email, body.email.trim().toLowerCase()))
            .limit(1);
          if (row && row.status !== 'active' && row.status !== 'invited') {
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
