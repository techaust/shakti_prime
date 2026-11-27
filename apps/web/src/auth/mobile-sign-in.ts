import type { MobileTokenRequest } from '@shakti/contracts';
import { authDb, authSchema } from '@shakti/db/auth';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { normaliseBackupCode } from './backup-codes';
import { signInFromFieldApp, type Auth } from './create-auth';

/**
 * Checks the field app's email, password and second factor through the app's one Better Auth
 * instance (docs/03-roadmap-appendix/phase4.md §6.4): the same password check, sign-in lock,
 * per-address cap, authenticator check, one-use codes and audit rows as the website's sign-in. Only
 * the bot check is left out (`signInFromFieldApp`). Better Auth makes a website session on the way;
 * it is deleted at once, since the phone holds its own tokens and no cookie ever reaches it.
 */

/** Why the credentials were refused, as `MOBILE_AUTH_REASONS` names it. */
export type CredentialRefusal =
  | { reason: 'invalid_credentials' | 'totp_required' | 'totp_invalid' }
  | { reason: 'account_locked'; retryAfter: string | undefined };

export type CredentialOutcome =
  { kind: 'ok'; userId: string } | ({ kind: 'refused' } & CredentialRefusal);

/** Better Auth's codes for a wrong second factor, and for one locked after five wrong codes. */
const WRONG_CODE = new Set(['INVALID_CODE', 'INVALID_BACKUP_CODE', 'INVALID_TWO_FACTOR_COOKIE']);
const LOCKED = new Set([
  'ACCOUNT_LOCKED',
  'ACCOUNT_TEMPORARILY_LOCKED',
  'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
]);

function refusalOf(error: unknown, stage: 'password' | 'code'): CredentialOutcome {
  if (!(error instanceof APIError)) throw error;
  const code = typeof error.body?.code === 'string' ? error.body.code : '';
  if (LOCKED.has(code) || error.statusCode === 429) {
    const retryAfter = new Headers(error.headers).get('retry-after') ?? undefined;
    return { kind: 'refused', reason: 'account_locked', retryAfter };
  }
  if (stage === 'code' && (WRONG_CODE.has(code) || error.statusCode === 401)) {
    return { kind: 'refused', reason: 'totp_invalid' };
  }
  if (error.statusCode === 401 || error.statusCode === 400 || error.statusCode === 403) {
    return { kind: 'refused', reason: 'invalid_credentials' };
  }
  throw error;
}

/** `set-cookie` values of a response → a `cookie` request header. */
function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => c !== '')
    .join('; ');
}

/**
 * The headers Better Auth is handed: the caller's address, app and request id, for the lock, the
 * caps and the audit rows; never a cookie or the bearer, so no website session is read.
 */
export function authHeadersFrom(incoming: Headers): Headers {
  const out = new Headers();
  for (const name of ['x-forwarded-for', 'user-agent', 'x-vercel-id', 'x-request-id']) {
    const value = incoming.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

async function dropSession(token: unknown): Promise<void> {
  if (typeof token !== 'string' || token === '') return;
  const s = authSchema.sessions;
  await authDb().delete(s).where(eq(s.token, token));
}

/** Checks the credentials of a field app sign-in; answers the person or why they were refused. */
export async function verifyMobileCredentials(
  auth: Auth,
  request: Pick<MobileTokenRequest, 'email' | 'password' | 'totpCode' | 'backupCode'>,
  incoming: Headers,
): Promise<CredentialOutcome> {
  const headers = authHeadersFrom(incoming);
  return signInFromFieldApp(async () => {
    let first: { headers: Headers; response: unknown };
    try {
      const result = await auth.api.signInEmail({
        body: { email: request.email, password: request.password },
        headers,
        returnHeaders: true,
      });
      first = { headers: result.headers, response: result.response };
    } catch (error) {
      return refusalOf(error, 'password');
    }
    const answer = first.response as {
      twoFactorRedirect?: unknown;
      token?: unknown;
      user?: { id?: unknown };
    };
    if (answer.twoFactorRedirect !== true) {
      await dropSession(answer.token);
      const userId = answer.user?.id;
      if (typeof userId !== 'string') throw new Error('the sign-in named no person');
      return { kind: 'ok', userId };
    }
    if (request.totpCode === undefined && request.backupCode === undefined) {
      return { kind: 'refused', reason: 'totp_required' };
    }
    const pending = new Headers(headers);
    pending.set('cookie', cookieHeader(first.headers));
    let second: { token?: unknown; user?: { id?: unknown } };
    try {
      second =
        request.totpCode !== undefined
          ? await auth.api.verifyTOTP({ body: { code: request.totpCode }, headers: pending })
          : await auth.api.verifyBackupCode({
              body: { code: normaliseBackupCode(request.backupCode ?? '') },
              headers: pending,
            });
    } catch (error) {
      return refusalOf(error, 'code');
    }
    await dropSession(second.token);
    const userId = second.user?.id;
    if (typeof userId !== 'string') throw new Error('the second factor named no person');
    return { kind: 'ok', userId };
  });
}
