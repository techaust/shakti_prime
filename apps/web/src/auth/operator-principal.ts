import type { Principal } from '@shakti/contracts';
import { authDb, authSchema } from '@shakti/db/auth';
import { loadUserGrants, type UserGrantRow } from '@shakti/db/grants';
import { groupUserGrants, resolvePrincipalFromGrants } from '@shakti/domain';
import { asc, eq } from 'drizzle-orm';
import { hostedRuntime } from './deps';

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
 * Refuses to build a principal without a sign-in anywhere but a command line on a machine that is
 * not hosted: inside Next.js (`NEXT_RUNTIME` is set in every server runtime) or on a hosted
 * runtime (`hostedRuntime`), a request could otherwise act as the Executive.
 */
export function assertCommandLine(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.NEXT_RUNTIME ?? '') !== '' || hostedRuntime(env)) {
    throw new Error('the operator principal is for command-line scripts only');
  }
}

/**
 * The first of `people`, in their order, whose every role is Executive and who may act. Someone
 * who is Executive in one company and holds another role elsewhere is passed over.
 */
export async function chooseExecutive(
  people: readonly { id: string; name: string }[],
  grantsOf: (userId: string) => Promise<UserGrantRow[]>,
): Promise<OperatorOutcome> {
  let waiting: string | undefined;
  for (const person of people) {
    const rows = await grantsOf(person.id);
    const access = groupUserGrants(rows);
    if (!access || access.entities.length === 0) continue;
    if (!access.entities.every((e) => e.roleKey === 'executive')) continue;
    const outcome = resolvePrincipalFromGrants(person.id, rows);
    if (outcome.kind === 'principal') {
      return { kind: 'ready', principal: outcome.principal, name: person.name };
    }
    waiting ??= person.name;
  }
  return waiting === undefined ? { kind: 'none' } : { kind: 'not_ready', name: waiting };
}

/**
 * The earliest active person whose every role is Executive and who may act, resolved from their
 * grants as a sign-in resolves them (`resolvePrincipalFromGrants`). Principal resolution lives in
 * the auth module, the one place allowed to read a person's grants before a request context
 * exists; `assertCommandLine` keeps this one out of every request path.
 */
export async function firstExecutive(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OperatorOutcome> {
  assertCommandLine(env);
  const u = authSchema.users;
  let waiting: string | undefined;
  for (let offset = 0; ; offset += PAGE) {
    const page = await authDb()
      .select({ id: u.id, name: u.name })
      .from(u)
      .where(eq(u.status, 'active'))
      .orderBy(asc(u.createdAt), asc(u.id))
      .limit(PAGE)
      .offset(offset);
    const found = await chooseExecutive(page, loadUserGrants);
    if (found.kind === 'ready') return found;
    if (found.kind === 'not_ready') waiting ??= found.name;
    if (page.length < PAGE) break;
  }
  return waiting === undefined ? { kind: 'none' } : { kind: 'not_ready', name: waiting };
}
