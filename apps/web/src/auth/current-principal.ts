import { EntityIdSchema, type Principal } from '@shakti/contracts';
import { cookies, headers } from 'next/headers';
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

async function activeEntityId(): Promise<number | undefined> {
  const raw = (await cookies()).get(ACTIVE_ENTITY_COOKIE)?.value;
  const parsed = EntityIdSchema.safeParse(Number(raw));
  return raw !== undefined && parsed.success ? parsed.data : undefined;
}

/** The session and, when the user may act, their principal. For the auth screens. */
export async function currentSession(): Promise<ResolvedSession | undefined> {
  const deps = defaultAuthDeps();
  return resolveSessionPrincipal(await headers(), await activeEntityId(), {
    auth,
    keyValue: deps.keyValue,
    now: deps.now,
  });
}

/**
 * Resolves the signed-in principal for a server action or route. Undefined when nobody is
 * signed in; throws `unauthorized` with reason `totp_required` until a mandatory authenticator
 * app is enrolled.
 */
export async function currentPrincipal(): Promise<Principal | undefined> {
  return requirePrincipal(await currentSession());
}

/** After a role, status or session change of a user, their cached principal is dropped. */
export function forgetPrincipal(userId: string): Promise<void> {
  return invalidatePrincipal(defaultAuthDeps().keyValue, userId);
}
