import { ERROR_CODES } from '@shakti/contracts';
import en from '../../messages/en.json';
import { REASONS } from './errors';
import { SIGN_IN_REASONS } from './sign-in-reasons';

/** The sentences the public forms set themselves (`actions/auth.ts`) rather than from an error. */
export const AUTH_FORM_ERRORS = ['email_invalid', 'password_mismatch'] as const;

/**
 * The `errors.*` sentences a public page can show (WEB-1): every general one, every reason a
 * sign-in, password or code failure maps to (`REASONS`), the reasons the sign-in page explains
 * and the forms' own. The rest of the catalogue's errors belong to staff screens and stay off
 * the public pages; a key outside this list would read as the general sentence (`FormError`).
 */
export const PUBLIC_ERROR_KEYS: readonly string[] = [
  ...new Set<string>([
    ...ERROR_CODES,
    ...Object.values(REASONS).map((r) => r.reason),
    ...SIGN_IN_REASONS,
    ...AUTH_FORM_ERRORS,
  ]),
].filter((key) => key in en.errors);
