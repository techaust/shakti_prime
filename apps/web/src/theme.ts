import type { Theme } from '@shakti/contracts';

/** Mirror of the profile's theme for server rendering (DESIGN.md §7). */
export const THEME_COOKIE = 'theme';

/** next-themes keeps the active choice in localStorage under this key. */
export const THEME_STORAGE_KEY = 'theme';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * The cookie that lets the first paint on this device use the saved theme. It holds only the
 * preference, so the browser may read it; `undefined` clears it (sign-out on a shared desk).
 */
export function themeCookie(theme: Theme | undefined, secure: boolean): string {
  const value = theme ?? '';
  const maxAge = theme === undefined ? 0 : ONE_YEAR_SECONDS;
  return `${THEME_COOKIE}=${value}; Path=/; Max-Age=${String(maxAge)}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
