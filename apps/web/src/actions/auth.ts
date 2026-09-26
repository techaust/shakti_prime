'use server';

import { EntityIdSchema, PasswordSchema } from '@shakti/contracts';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { toDataURL } from 'qrcode';
import { auth } from '../auth/auth';
import { ACTIVE_ENTITY_COOKIE, currentSession, forgetPrincipal } from '../auth/current-principal';
import { errorKey, toDomainError } from '../auth/errors';
import { revokeOtherSessions, sessionTokenFromSetCookie } from '../auth/session-principal';
import { TURNSTILE_HEADER } from '../auth/turnstile';

/** State of a form action: a catalogue key under `errors`, or nothing when it succeeded. */
export interface FormState {
  error?: string;
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
    return { error: errorKey(toDomainError(e)) };
  }
  redirect(twoFactor ? '/two-factor' : '/home');
}

export async function signOut(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // an already-ended session signs out all the same
  }
  redirect('/sign-in');
}

export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = field(formData, 'password');
  if (password !== field(formData, 'confirm')) return { error: 'password_mismatch' };
  if (!PasswordSchema.safeParse(password).success) {
    return { error: password.length < 12 ? 'password_too_short' : 'password_too_long' };
  }
  try {
    await auth.api.resetPassword({
      body: { newPassword: password, token: field(formData, 'token') },
      headers: await headers(),
    });
  } catch (e) {
    return { error: errorKey(toDomainError(e)) };
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
    return { error: errorKey(toDomainError(e)) };
  }
}

export async function verifyTwoFactor(_prev: FormState, formData: FormData): Promise<FormState> {
  const before = await currentSession();
  let issued: Headers;
  try {
    const result = await auth.api.verifyTOTP({
      body: { code: field(formData, 'code').replaceAll(/\s+/g, '') },
      headers: await headers(),
      returnHeaders: true,
    });
    issued = result.headers;
  } catch (e) {
    return { error: errorKey(toDomainError(e)) };
  }
  if (before && !before.access.twoFactorEnabled) {
    // Enrolment is a privilege change: every other sign-in of this user ends (docs/SECURITY.md §2).
    // The enrolment itself re-issued the session; its token is in the cookie just set.
    await revokeOtherSessions(
      before.session.userId,
      sessionTokenFromSetCookie(issued),
      'totp_enrolled',
    );
    await forgetPrincipal(before.session.userId);
  }
  redirect('/home');
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const next = field(formData, 'newPassword');
  if (next !== field(formData, 'confirm')) return { error: 'password_mismatch' };
  if (!PasswordSchema.safeParse(next).success) {
    return { error: next.length < 12 ? 'password_too_short' : 'password_too_long' };
  }
  const session = await currentSession();
  try {
    await auth.api.changePassword({
      body: {
        currentPassword: field(formData, 'currentPassword'),
        newPassword: next,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (e) {
    return { error: errorKey(toDomainError(e)) };
  }
  if (session) await forgetPrincipal(session.session.userId);
  return {};
}

/** The entity switcher: an entity the user holds a role in, or "All companies". */
export async function switchEntity(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/sign-in');
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
  redirect('/home');
}
