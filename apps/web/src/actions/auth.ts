'use server';

import { EntityIdSchema, PASSWORD_MIN_LENGTH, PasswordSchema } from '@shakti/contracts';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { toDataURL } from 'qrcode';
import { auth } from '../auth/auth';
import { normaliseBackupCode } from '../auth/backup-codes';
import { requestResetInBackground } from '../auth/create-auth';
import { ACTIVE_ENTITY_COOKIE, currentSession, forgetPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { errorKey, toDomainError } from '../auth/errors';
import { reportUnexpected } from '../log';
import { finishEnrolment } from '../auth/session-principal';
import { TURNSTILE_HEADER } from '../auth/turnstile';
import { safeReturnPath } from '../session-gate';

/**
 * State of a form action: a catalogue key under `errors`, or nothing when it succeeded. An
 * unexpected failure also carries the reference the person reads to support (DESIGN.md §11).
 */
export interface FormState {
  error?: string;
  reference?: string;
  /** The one field the error is about, when there is one; otherwise the whole form (AUDIT L15). */
  field?: string;
}

export interface SetPasswordState extends FormState {
  done?: boolean;
}

export interface TwoFactorState extends FormState {
  /** After "Begin setup": what the enrolment screen shows. */
  qrDataUrl?: string;
  manualKey?: string;
  backupCodes?: string[];
}

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** Which field of a password form a reason is about. */
const PASSWORD_REASONS = new Set(['password_too_short', 'password_too_long', 'password_breached']);

/**
 * The form state for a failure; an unexpected one is logged with a reference (AUDIT M35).
 * `fields` names the field each reason concerns, so only that field is marked (AUDIT L15).
 */
function failure(
  action: string,
  e: unknown,
  fields: Readonly<Record<string, string>> = {},
): FormState {
  const domain = toDomainError(e);
  const error = errorKey(domain);
  const field = fields[error];
  const named = field === undefined ? {} : { field };
  if (domain.code !== 'internal' && domain.code !== 'integration_unavailable') {
    return { error, ...named };
  }
  return { error, reference: reportUnexpected('auth.action_failed', e, { action }) };
}

/** The reasons a new password is refused, each on the field that holds it. */
function passwordFields(newField: string): Record<string, string> {
  return Object.fromEntries([...PASSWORD_REASONS].map((reason) => [reason, newField]));
}

async function requestHeaders(turnstileToken?: string): Promise<Headers> {
  const h = new Headers(await headers());
  if (turnstileToken !== undefined) h.set(TURNSTILE_HEADER, turnstileToken);
  return h;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  let twoFactor = false;
  try {
    const result = await auth.api.signInEmail({
      body: { email: field(formData, 'email'), password: field(formData, 'password') },
      headers: await requestHeaders(field(formData, 'cf-turnstile-response')),
    });
    twoFactor = 'twoFactorRedirect' in result && result.twoFactorRedirect === true;
  } catch (e) {
    return failure('signIn', e);
  }
  // A company chosen by whoever used this browser before does not narrow this person (AUDIT L10).
  (await cookies()).delete(ACTIVE_ENTITY_COOKIE);
  redirect(twoFactor ? '/two-factor' : '/home');
}

export async function signOut(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // an already-ended session signs out all the same
  }
  (await cookies()).delete(ACTIVE_ENTITY_COOKIE);
  redirect('/sign-in');
}

/**
 * "Forgot your password?" (AUDIT M26): sends a set-password link when the email belongs to a
 * staff account. The answer is the same either way, so the screen does not reveal who has one.
 * The wait is the same too: the answer waits only for the per-address cap and the bot check,
 * which refuse before anything reads the account; finding the account, storing the link and the
 * mail run after the answer, and a failure there is logged, never shown.
 */
export async function requestNewPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  try {
    const headers = await requestHeaders(field(formData, 'cf-turnstile-response'));
    await requestResetInBackground(
      (task) => {
        after(task);
      },
      () =>
        auth.api.requestPasswordReset({
          body: {
            email: field(formData, 'email').trim().toLowerCase(),
            redirectTo: '/set-password',
          },
          headers,
        }),
    );
  } catch (e) {
    return failure('requestNewPassword', e);
  }
  return { done: true };
}

export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = field(formData, 'password');
  if (password !== field(formData, 'confirm')) {
    return { error: 'password_mismatch', field: 'confirm' };
  }
  if (!PasswordSchema.safeParse(password).success) {
    return {
      error: password.length < PASSWORD_MIN_LENGTH ? 'password_too_short' : 'password_too_long',
      field: 'password',
    };
  }
  try {
    await auth.api.resetPassword({
      body: { newPassword: password, token: field(formData, 'token') },
      headers: await headers(),
    });
  } catch (e) {
    return failure('setPassword', e, passwordFields('password'));
  }
  return { done: true };
}

export async function beginTwoFactor(
  _prev: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  try {
    const result = await auth.api.enableTwoFactor({
      body: { password: field(formData, 'password'), method: 'totp' },
      headers: await headers(),
    });
    if (result.method !== 'totp') return { error: 'authenticator_missing' };
    const uri = new URL(result.totpURI);
    return {
      qrDataUrl: await toDataURL(result.totpURI, { margin: 1, width: 220 }),
      manualKey: uri.searchParams.get('secret') ?? '',
      backupCodes: result.backupCodes,
    };
  } catch (e) {
    return failure('beginTwoFactor', e);
  }
}

export async function verifyTwoFactor(_prev: FormState, formData: FormData): Promise<FormState> {
  // Everything that can fail sits inside the try: a thrown error would reach the screen masked in
  // production. Only `redirect` stays outside, because it works by throwing.
  try {
    const before = await currentSession();
    const result = await auth.api.verifyTOTP({
      body: { code: field(formData, 'code').replaceAll(/\s+/g, '') },
      headers: await headers(),
      returnHeaders: true,
    });
    await finishEnrolment(before, result.headers, defaultAuthDeps().keyValue);
  } catch (e) {
    return failure('verifyTwoFactor', e);
  }
  redirect('/home');
}

/** Sign-in with one of the backup codes kept at enrolment, when the phone is not at hand. */
export async function verifyBackupCode(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await auth.api.verifyBackupCode({
      body: { code: normaliseBackupCode(field(formData, 'code')) },
      headers: await headers(),
    });
  } catch (e) {
    return failure('verifyBackupCode', e);
  }
  redirect('/home');
}

export async function changePassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const next = field(formData, 'newPassword');
  if (next !== field(formData, 'confirm')) return { error: 'password_mismatch', field: 'confirm' };
  if (!PasswordSchema.safeParse(next).success) {
    return {
      error: next.length < PASSWORD_MIN_LENGTH ? 'password_too_short' : 'password_too_long',
      field: 'newPassword',
    };
  }
  try {
    const session = await currentSession();
    if (!session || session.blocked !== undefined) return { error: 'unauthorized' };
    await auth.api.changePassword({
      body: {
        currentPassword: field(formData, 'currentPassword'),
        newPassword: next,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
    await forgetPrincipal(session.session.userId);
  } catch (e) {
    return failure('changePassword', e, {
      ...passwordFields('newPassword'),
      password_incorrect: 'currentPassword',
    });
  }
  return { done: true };
}

/**
 * The entity switcher: an entity the user holds a role in, or "All companies". The top bar sends
 * the screen it was on as `returnTo`, so the person stays where they were; only a BOS screen on
 * this site is accepted, anything else lands on Home. A failure is answered as a form state, which
 * the switcher shows as a toast, rather than thrown to a masked error screen.
 */
export async function switchEntity(formData: FormData): Promise<FormState> {
  let signedIn: boolean;
  try {
    const session = await currentSession();
    signedIn = session !== undefined;
    if (session) {
      const raw = field(formData, 'entityId');
      const jar = await cookies();
      const parsed = EntityIdSchema.safeParse(Number(raw));
      if (raw === '' || !parsed.success) {
        jar.delete(ACTIVE_ENTITY_COOKIE);
      } else if (session.access.entities.some((e) => e.entityId === parsed.data)) {
        jar.set(ACTIVE_ENTITY_COOKIE, String(parsed.data), {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
        });
      }
    }
  } catch (e) {
    return failure('switchEntity', e);
  }
  if (!signedIn) redirect('/sign-in');
  redirect(safeReturnPath(field(formData, 'returnTo') || undefined));
}
