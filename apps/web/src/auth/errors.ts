import { DomainError } from '@shakti/contracts';
import { APIError } from 'better-auth/api';

/** Better Auth error codes → catalogue reasons (`errors.*`). Anything else is the generic sentence. */
export const REASONS: Record<string, { code: DomainError['code']; reason: string }> = {
  BOT_CHECK_FAILED: { code: 'validation_failed', reason: 'bot_check_failed' },
  ACCOUNT_LOCKED: { code: 'rate_limited', reason: 'account_locked' },
  INVALID_EMAIL_OR_PASSWORD: { code: 'unauthorized', reason: 'sign_in_failed' },
  INVALID_EMAIL: { code: 'validation_failed', reason: 'sign_in_failed' },
  INVALID_PASSWORD: { code: 'validation_failed', reason: 'password_incorrect' },
  PASSWORD_TOO_SHORT: { code: 'validation_failed', reason: 'password_too_short' },
  PASSWORD_TOO_LONG: { code: 'validation_failed', reason: 'password_too_long' },
  PASSWORD_COMPROMISED: { code: 'validation_failed', reason: 'password_breached' },
  INVALID_TOKEN: { code: 'validation_failed', reason: 'link_expired' },
  INVALID_CODE: { code: 'validation_failed', reason: 'code_incorrect' },
  INVALID_BACKUP_CODE: { code: 'validation_failed', reason: 'backup_code_incorrect' },
  TOTP_ALREADY_ENABLED: { code: 'conflict', reason: 'authenticator_already_set' },
  TOTP_NOT_ENABLED: { code: 'validation_failed', reason: 'authenticator_missing' },
  TWO_FACTOR_NOT_ENABLED: { code: 'validation_failed', reason: 'authenticator_missing' },
  BACKUP_CODES_NOT_ENABLED: { code: 'validation_failed', reason: 'authenticator_missing' },
  ACCOUNT_TEMPORARILY_LOCKED: { code: 'rate_limited', reason: 'account_locked' },
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: { code: 'unauthorized', reason: 'code_attempts_exhausted' },
  INVALID_TWO_FACTOR_COOKIE: { code: 'unauthorized', reason: 'code_session_expired' },
  TRUSTED_DEVICE_OFF: { code: 'validation_failed', reason: 'request_refused' },
  INVALID_ORIGIN: { code: 'validation_failed', reason: 'request_refused' },
  MISSING_OR_NULL_ORIGIN: { code: 'validation_failed', reason: 'request_refused' },
  UNAUTHORIZED: { code: 'unauthorized', reason: 'unauthorized' },
  SESSION_EXPIRED: { code: 'unauthorized', reason: 'unauthorized' },
};

/** Turns a Better Auth failure into the one error type the app handles. */
export function toDomainError(e: unknown): DomainError {
  if (e instanceof DomainError) return e;
  if (e instanceof APIError) {
    const code = typeof e.body?.code === 'string' ? e.body.code : undefined;
    const mapped = code === undefined ? undefined : REASONS[code];
    if (mapped) return new DomainError(mapped.code, e.message, { reason: mapped.reason });
    if (e.statusCode === 401) return new DomainError('unauthorized', e.message);
    if (e.statusCode === 429) {
      return new DomainError('rate_limited', e.message, { reason: 'account_locked' });
    }
    if (e.statusCode >= 400 && e.statusCode < 500) {
      return new DomainError('validation_failed', e.message);
    }
  }
  return new DomainError('internal', e instanceof Error ? e.message : 'auth failure');
}

/** The catalogue key for an error: `errors.<reason>` when one is mapped, else `errors.<code>`. */
export function errorKey(e: DomainError): string {
  const reason = e.details?.reason;
  return typeof reason === 'string' ? reason : e.code;
}
