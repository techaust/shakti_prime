import { executeQuery, principalForEntity, readScreenPop } from '@shakti/domain';
import { headers } from 'next/headers';
import { auth } from '../../../../../auth/auth';
import { defaultAuthDeps } from '../../../../../auth/deps';
import { requirePrincipal, resolveSessionPrincipal } from '../../../../../auth/session-principal';
import { ringingRoute } from '../../../../../calls/ringing-route';

export const dynamic = 'force-dynamic';

/**
 * The person in the call's company, whatever company the switcher shows: the session checked, not
 * extended (the poll is not the person's doing, WEB-8), and the person's grants in that company.
 */
async function personIn(entityId: number) {
  const deps = defaultAuthDeps();
  const session = await resolveSessionPrincipal(
    await headers(),
    undefined,
    { auth, keyValue: deps.keyValue, now: deps.now },
    'quiet',
  );
  const principal = requirePrincipal(session);
  if (principal === undefined || session === undefined) return undefined;
  return principalForEntity(principal, session.access, entityId);
}

/**
 * The screen-pop's ringing call for the person the ticket names (docs/06-api.md §3.5): read from
 * the key-value store only, and shown under the person's own session when one is waiting.
 */
export function GET(request: Request): Promise<Response> {
  return ringingRoute(request, {
    keyValue: () => defaultAuthDeps().keyValue,
    personIn,
    read: (principal, pending, requestId) =>
      executeQuery(
        principal,
        { entityIds: principal.entityIds, requestId },
        (ctx) => readScreenPop(ctx, pending),
        { name: 'calls.screen_pop.read' },
      ),
    now: () => new Date(),
  });
}
