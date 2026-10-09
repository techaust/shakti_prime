import { EntityIdSchema, type Principal } from '@shakti/contracts';
import { principalForEntity } from '@shakti/domain';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { tagSentryPrincipal } from '../observability/sentry-tag';
import { auth } from './auth';
import { defaultAuthDeps } from './deps';
import {
  invalidatePrincipal,
  requirePrincipal,
  resolveSessionPrincipal,
  type ResolvedSession,
} from './session-principal';

/** The entity switcher's cookie: absent means "All entities". */
export const ACTIVE_ENTITY_COOKIE = 'entity';

/** Better Auth's cookie for a sign-in waiting for its second factor (prefix `shakti`). */
export const TWO_FACTOR_PENDING_COOKIE = 'shakti.two_factor';

async function activeEntityId(): Promise<number | undefined> {
  const raw = (await cookies()).get(ACTIVE_ENTITY_COOKIE)?.value;
  const parsed = EntityIdSchema.safeParse(Number(raw));
  return raw !== undefined && parsed.success ? parsed.data : undefined;
}

/**
 * The session and, when the user may act, their principal. For the auth screens. Resolved once
 * per request: the layout and the page both ask, and each answer costs a round of auth queries
 * and cache calls (AUDIT M34).
 */
export const currentSession = cache(async (): Promise<ResolvedSession | undefined> => {
  const deps = defaultAuthDeps();
  return resolveSessionPrincipal(await headers(), await activeEntityId(), {
    auth,
    keyValue: deps.keyValue,
    now: deps.now,
  });
});

/**
 * Resolves the signed-in principal for a server action or route. Undefined when nobody is
 * signed in; throws `unauthorized` with reason `totp_required` until a mandatory authenticator
 * app is enrolled.
 */
export async function currentPrincipal(): Promise<Principal | undefined> {
  const principal = requirePrincipal(await currentSession());
  if (principal !== undefined) await tagSentryPrincipal(principal.id);
  return principal;
}

/**
 * The signed-in person as they act in one company they hold a role in: that company's grants and
 * team, not the intersection across companies that "All companies" gives. Undefined when nobody
 * is signed in or the person holds no role in the company.
 */
export async function currentPrincipalIn(entityId: number): Promise<Principal | undefined> {
  const session = await currentSession();
  const principal = requirePrincipal(session);
  if (principal === undefined || session === undefined) return undefined;
  return principalForEntity(principal, session.access, entityId);
}

/** After a role, status or session change of a user, their cached principal is dropped. */
export function forgetPrincipal(userId: string): Promise<void> {
  return invalidatePrincipal(defaultAuthDeps().keyValue, userId);
}
