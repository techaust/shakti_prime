import type { Theme } from '@shakti/contracts';

/** Mirror of the profile's theme for server rendering (DESIGN.md §7). */
export const THEME_COOKIE = 'theme';

/** next-themes keeps the active choice in localStorage under this key. */
export const THEME_STORAGE_KEY = 'theme';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Mirror of the profile's higher-contrast choice (DESIGN.md §2.1, the variant for field phones in
 * daylight) for server rendering, as `THEME_COOKIE` mirrors the theme: a cookie, not browser
 * storage, so the server draws the first paint in it. The profile (`users.contrast`) is the record.
 */
export const CONTRAST_COOKIE = 'contrast';

/** The value `<html data-contrast>` takes, which selects the high-contrast token blocks. */
export const HIGH_CONTRAST = 'high';

export function isHighContrast(value: string | undefined): boolean {
  return value === HIGH_CONTRAST;
}

/** The cookie line for the choice; the standard contrast clears the cookie. */
export function contrastCookie(high: boolean, secure: boolean): string {
  const value = high ? HIGH_CONTRAST : '';
  const maxAge = high ? ONE_YEAR_SECONDS : 0;
  return `${CONTRAST_COOKIE}=${value}; Path=/; Max-Age=${String(maxAge)}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/**
 * The cookie that lets the first paint on this device use the saved theme. It holds only the
 * preference, so the browser may read it; `undefined` clears it (sign-out on a shared desk).
 */
export function themeCookie(theme: Theme | undefined, secure: boolean): string {
  const value = theme ?? '';
  const maxAge = theme === undefined ? 0 : ONE_YEAR_SECONDS;
  return `${THEME_COOKIE}=${value}; Path=/; Max-Age=${String(maxAge)}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
