import {
  DomainError,
  SESSION_ABSOLUTE_SECONDS,
  type Principal,
  type SessionRevokeReason,
} from '@shakti/contracts';
import { loadUserGrants } from '@shakti/db/grants';
import { authDb, authSchema } from '@shakti/db/auth';
import { resolvePrincipalFromGrants, type KeyValue, type UserAccess } from '@shakti/domain';
import { APIError } from 'better-auth/api';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Auth } from './create-auth';
import { principalCache } from './principal-cache';

/** How often `last_seen_at` is written. */
const LAST_SEEN_BUMP_SECONDS = 60;

export interface SessionInfo {
  sessionId: string;
  userId: string;
  createdAt: Date;
}

export interface ResolvedSession {
  session: SessionInfo;
  /** Present when the user may act; absent while the authenticator app is still to be enrolled. */
  principal: Principal | undefined;
  access: UserAccess;
  /** Set when the session is live but the user may not act at all (the screens sign them out). */
  blocked?: 'inactive' | 'no_access';
}

interface Deps {
  auth: Auth;
  keyValue: KeyValue;
  now: () => Date;
}

/**
 * Loads the Better Auth session behind the request and applies the app's own rules: a revoked
 * row, a row past the 7-day absolute limit (docs/07-security.md §2) or an unknown session answers
 * undefined. `last_seen_at` is written at most once a minute.
 */
async function loadSession(headers: Headers, deps: Deps): Promise<SessionInfo | undefined> {
  // A session the app has ended is refused by the auth routes themselves (create-auth.ts). Only
  // that refusal means "signed out"; a database or network failure is an outage and reaches the
  // error screen, instead of sending the person round the sign-in page (AUDIT M36).
  const result = await deps.auth.api.getSession({ headers }).catch((e: unknown) => {
    if (e instanceof APIError && (e.statusCode === 401 || e.statusCode === 403)) return null;
    throw e;
  });
  if (!result) return undefined;
  // Better Auth returns the session row with the app's own columns, and its before hook has
  // already refused a revoked or expired one, so there is no second read of the row (AUDIT M34).
  const row = result.session;
  const s = authSchema.sessions;
  const now = deps.now();
  if (row.revokedAt != null) return undefined;
  if (now.getTime() - row.createdAt.getTime() > SESSION_ABSOLUTE_SECONDS * 1000) {
    await authDb()
      .update(s)
      .set({ revokedAt: now, revokedReason: 'absolute_expiry' })
      .where(and(eq(s.id, row.id), isNull(s.revokedAt)));
    return undefined;
  }
  const lastSeen = row.lastSeenAt == null ? undefined : new Date(row.lastSeenAt);
  if (
    lastSeen === undefined ||
    now.getTime() - lastSeen.getTime() > LAST_SEEN_BUMP_SECONDS * 1000
  ) {
    await authDb().update(s).set({ lastSeenAt: now }).where(eq(s.id, row.id));
  }
  return { sessionId: row.id, userId: row.userId, createdAt: row.createdAt };
}

/** Drops every cached principal of a user: called after a role, status or session change. */
export async function invalidatePrincipal(keyValue: KeyValue, userId: string): Promise<void> {
  await principalCache(keyValue).invalidate(userId);
}

/**
 * Resolves the caller of a server action (docs/03-roadmap-appendix/backend-weeks-3-5.md §2.3). Throws
 * `unauthorized` with reason `totp_required` when the role demands an authenticator app that is
 * not enrolled yet; answers undefined when there is no usable session.
 */
export async function resolveSessionPrincipal(
  headers: Headers,
  activeEntityId: number | undefined,
  deps: Deps,
): Promise<ResolvedSession | undefined> {
  const session = await loadSession(headers, deps);
  if (!session) return undefined;

  const cache = principalCache(deps.keyValue);
  const key = await cache.keyFor(session.userId, session.sessionId, activeEntityId);
  const cached = await cache.read(key);
  if (cached) return { session, principal: cached.principal, access: cached.access };

  const rows = await loadUserGrants(session.userId);
  let outcome = resolvePrincipalFromGrants(session.userId, rows, activeEntityId);
  // A switcher cookie naming an entity the user no longer holds falls back to all companies.
  if (outcome.kind === 'entity_not_held') {
    outcome = resolvePrincipalFromGrants(session.userId, rows, undefined);
  }
  if (outcome.kind === 'totp_required') {
    return { session, principal: undefined, access: outcome.access };
  }
  if (outcome.kind === 'inactive' || outcome.kind === 'no_access') {
    return { session, principal: undefined, access: outcome.access, blocked: outcome.kind };
  }
  if (outcome.kind !== 'principal') return undefined;
  await cache.write(key, { principal: outcome.principal, access: outcome.access });
  return { session, principal: outcome.principal, access: outcome.access };
}

/** The principal, or the `totp_required` error the actions surface to the code screen. */
export function requirePrincipal(resolved: ResolvedSession | undefined): Principal | undefined {
  if (!resolved || resolved.blocked !== undefined) return undefined;
  if (!resolved.principal) {
    throw new DomainError('unauthorized', 'authenticator app enrolment required', {
      reason: 'totp_required',
    });
  }
  return resolved.principal;
}

/**
 * The session token named by a response's session cookie. Better Auth re-issues the session on
 * enrolment, so the request's own cookie is stale by then; the fresh token is in `set-cookie`.
 */
function sessionTokenFromSetCookie(headers: Headers): string | undefined {
  for (const cookie of headers.getSetCookie()) {
    const pair = cookie.split(';')[0] ?? '';
    const at = pair.indexOf('=');
    if (at === -1) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (!name.includes('session') || value === '') continue;
    const token = decodeURIComponent(value).split('.')[0];
    if (token !== undefined && token !== '') return token;
  }
  return undefined;
}

/** Ends every other sign-in of a user after a privilege change (enrolment, password change). */
export async function revokeOtherSessions(
  userId: string,
  keepToken: string | undefined,
  reason: SessionRevokeReason,
): Promise<void> {
  const s = authSchema.sessions;
  const where =
    keepToken === undefined
      ? and(eq(s.userId, userId), isNull(s.revokedAt))
      : and(eq(s.userId, userId), isNull(s.revokedAt), ne(s.token, keepToken));
  await authDb().update(s).set({ revokedAt: new Date(), revokedReason: reason }).where(where);
}

/**
 * After a first authenticator enrolment: enrolment is a privilege change, so every other sign-in
 * of the user ends (docs/07-security.md §2) and their cached principal is dropped. The enrolment
 * re-issued the session, so the one to keep is named by the cookie it just set (`issued`).
 */
export async function finishEnrolment(
  before: ResolvedSession | undefined,
  issued: Headers,
  keyValue: KeyValue,
): Promise<void> {
  if (!before || before.access.twoFactorEnabled) return;
  await revokeOtherSessions(
    before.session.userId,
    sessionTokenFromSetCookie(issued),
    'totp_enrolled',
  );
  await invalidatePrincipal(keyValue, before.session.userId);
}
