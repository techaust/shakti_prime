import type { Principal } from '@shakti/contracts';
import { authDb, authSchema } from '@shakti/db/auth';
import { loadUserGrants } from '@shakti/db/grants';
import { groupUserGrants, resolvePrincipalFromGrants } from '@shakti/domain';
import { asc, eq } from 'drizzle-orm';

/** People read per round while looking for an Executive. */
const PAGE = 200;

/**
 * Who a command-line script acts as (`apps/web/scripts/demo-data.ts`): the first Executive, as the
 * principal their own sign-in would resolve to for every company they hold. `none` when the
 * database has no active Executive; `not_ready` when Executives exist but none can act yet (no
 * authenticator app enrolled), which the script reports instead of acting with less.
 */
export type OperatorOutcome =
  | { kind: 'ready'; principal: Principal; name: string }
  | { kind: 'none' }
  | { kind: 'not_ready'; name: string };

/**
 * The earliest active person whose every role is Executive and who may act, resolved from their
 * grants as a sign-in resolves them (`resolvePrincipalFromGrants`). Principal resolution lives in
 * the auth module, the one place allowed to read a person's grants before a request context
 * exists.
 */
export async function firstExecutive(): Promise<OperatorOutcome> {
  const u = authSchema.users;
  let waiting: string | undefined;
  for (let offset = 0; ; offset += PAGE) {
    const people = await authDb()
      .select({ id: u.id, name: u.name })
      .from(u)
      .where(eq(u.status, 'active'))
      .orderBy(asc(u.createdAt), asc(u.id))
      .limit(PAGE)
      .offset(offset);
    for (const person of people) {
      const rows = await loadUserGrants(person.id);
      const access = groupUserGrants(rows);
      if (!access || access.entities.length === 0) continue;
      if (!access.entities.every((e) => e.roleKey === 'executive')) continue;
      const outcome = resolvePrincipalFromGrants(person.id, rows);
      if (outcome.kind === 'principal') {
        return { kind: 'ready', principal: outcome.principal, name: person.name };
      }
      waiting ??= person.name;
    }
    if (people.length < PAGE) break;
  }
  return waiting === undefined ? { kind: 'none' } : { kind: 'not_ready', name: waiting };
}
