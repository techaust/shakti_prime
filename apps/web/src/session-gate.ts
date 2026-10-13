/**
 * The optimistic session check the proxy runs before a BOS screen (ARCHITECTURE §4): a request
 * for a `(bos)` route that carries no session cookie at all goes straight to sign-in. It reads
 * only the cookie's presence; whether the session is live, revoked or still waiting for its
 * second factor is decided by the `(bos)` layout and `currentPrincipal()`.
 *
 * Kept free of the auth module, so the proxy loads nothing but this file on every request.
 */

/**
 * Better Auth's session cookie: `<prefix>.session_token` over plain HTTP (local), and the
 * `__Host-` name `create-auth.ts` sets when cookies are secure.
 */
export const SESSION_COOKIE = 'shakti.session_token';
export const SECURE_SESSION_COOKIE = '__Host-shakti-session';

/**
 * The first path segment of every screen in the `(bos)` route group. `session-gate.test.ts`
 * checks this list against the folders of `app/(bos)`, so a new screen cannot be left out.
 */
export const BOS_PREFIXES = [
  '/home',
  '/leads',
  '/customers',
  '/duplicates',
  '/quotes',
  '/orders',
  '/dealer-credit',
  '/targets',
  '/converters',
  '/converting',
  '/inbox',
  '/imports',
  '/price-master',
  '/catalogue',
  '/admin',
  '/settings',
  '/design',
  '/calling',
  '/knowledge',
] as const;

/** True for a path inside the `(bos)` route group. */
export function isBosPath(pathname: string): boolean {
  return BOS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** True when the request names a session cookie with a value (live or not). */
export function hasSessionCookie(cookie: (name: string) => string | undefined): boolean {
  return [SESSION_COOKIE, SECURE_SESSION_COOKIE].some((name) => (cookie(name) ?? '') !== '');
}

/**
 * True when the proxy should send this request to sign-in before any screen code runs. A server
 * action's call (a POST naming the action) is never redirected: an action asked of an ended
 * session answers `unauthorized` itself, and the screen sends the person to sign in from where
 * they were (WEB-7). A redirect would turn that answer into an unreadable one.
 */
export function needsSignIn(
  pathname: string,
  cookie: (name: string) => string | undefined,
  serverAction = false,
): boolean {
  return !serverAction && isBosPath(pathname) && !hasSessionCookie(cookie);
}

/**
 * The request header the proxy sets to the path asked for, so the `(bos)` layout, which is not
 * told its path, can send a person whose session has ended back to it (`expiredSignInPath`).
 */
export const PATH_HEADER = 'x-shakti-path';

/**
 * Where the `(bos)` layout sends a request whose session cookie names no live session (it expired
 * or was ended): sign-in, saying why, and back to the screen afterwards (WEB-7). The path comes
 * from the proxy's header and is checked again by `safeReturnPath`.
 */
export function expiredSignInPath(requestHeaders: Headers): string {
  return signInPath(requestHeaders.get(PATH_HEADER) ?? '/home', 'session_ended');
}

/** The header Next.js sends with a server action's call. */
export const SERVER_ACTION_HEADER = 'next-action';

/**
 * The sign-in screen that brings the person back to `from` (a BOS screen; anything else goes
 * home) once they have signed in, saying why they are there when `reason` names a sign-in reason.
 */
export function signInPath(from: string, reason?: 'session_ended'): string {
  const back = safeReturnPath(from);
  const query = new URLSearchParams();
  if (reason !== undefined) query.set('reason', reason);
  if (back !== '/home') query.set('returnTo', back);
  const text = query.toString();
  return text === '' ? '/sign-in' : `/sign-in?${text}`;
}

/**
 * A path a form may return to after a change such as the company switch: a BOS screen on this
 * site, never another site or a public page. Anything else answers `/home`.
 */
export function safeReturnPath(raw: string | undefined): string {
  if (raw === undefined || !raw.startsWith('/') || raw.startsWith('//')) return '/home';
  if (/[\\\s]/.test(raw)) return '/home';
  const path = raw.split(/[?#]/)[0] ?? '';
  return isBosPath(path) ? path : '/home';
}
