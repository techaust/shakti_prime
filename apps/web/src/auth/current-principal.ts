import type { Principal } from '@shakti/contracts';

/**
 * Resolves the signed-in principal for a server action or route. Better Auth sessions arrive in
 * week 3; until then there is no session, so every action is refused as `unauthorized`.
 */
export function currentPrincipal(): Promise<Principal | undefined> {
  return Promise.resolve(undefined);
}
