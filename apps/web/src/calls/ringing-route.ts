import { isDomainError, type Principal, type ScreenPopDto } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';
import { apiFailure } from '../api-failure';
import { logger } from '../log';
import { incomingRequestId } from '../request-id';
import { takeRinging } from './ringing';
import { readRingingTicket, RINGING_TICKET_HEADER } from './ticket';

/** What the ringing route reaches beyond the request; tests pass their own. */
export interface RingingRouteDeps {
  /** The shared store a ringing call waits in. */
  keyValue: () => KeyValue;
  /**
   * The signed-in person as they act in one company, their session checked and not extended; undefined
   * without a usable session or a role there. May throw `unauthorized` (`totp_required`).
   */
  personIn: (entityId: number) => Promise<Principal | undefined>;
  /** `readScreenPop` under the person's own policies. */
  read: (principal: Principal, pending: unknown, requestId: string) => Promise<ScreenPopDto>;
  now: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
}

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * `GET /api/v1/calls/ringing` (docs/06-api.md §3.5, docs/03-roadmap-appendix/phase2.md §7.4): the
 * screen-pop's poll, every 3 seconds while a caller's page is in view, or once when Realtime wakes
 * the page. The person is named by the ticket in `x-ringing-ticket` (`ticket.ts`), so a poll with
 * nothing ringing reads the key-value store once and no database: `204` with no body. A ringing
 * call is taken once (`takeRinging`) and only then is the person's session read: the call is shown
 * under their own policies (`readScreenPop`), and to nobody when the session is gone or names
 * someone else. A ticket that is missing, forged or past its end is `401`, and the screen asks
 * for a new one.
 */
export async function ringingRoute(request: Request, deps: RingingRouteDeps): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { ...NO_STORE, 'x-request-id': requestId };
  const userId = readRingingTicket(
    request.headers.get(RINGING_TICKET_HEADER),
    deps.now(),
    deps.env ?? process.env,
  );
  if (userId === undefined) return apiFailure('unauthorized', requestId);

  let pending;
  try {
    pending = await takeRinging(deps.keyValue(), userId);
  } catch (error) {
    logger.log('error', 'calls.ringing_store_failed', { requestId, error });
    return apiFailure('integration_unavailable', requestId);
  }
  if (pending === undefined) return new Response(null, { status: 204, headers });

  let principal: Principal | undefined;
  try {
    principal = await deps.personIn(pending.entityId);
  } catch (error) {
    if (isDomainError(error) && error.code === 'unauthorized') {
      return apiFailure('unauthorized', requestId);
    }
    logger.log('error', 'calls.ringing_principal_failed', { requestId, error });
    return apiFailure('internal', requestId);
  }
  // The ticket's person must be the session's: a call is never shown to anyone else.
  if (principal?.id !== userId) {
    logger.log('warn', 'calls.ringing_not_shown', {
      requestId,
      providerCallId: pending.providerCallId,
    });
    return apiFailure('unauthorized', requestId);
  }
  try {
    const pop = await deps.read(principal, pending, requestId);
    logger.log('info', 'calls.ringing_shown', {
      requestId,
      providerCallId: pop.providerCallId,
      customers: pop.customers.length,
    });
    return Response.json(pop, { headers });
  } catch (error) {
    if (isDomainError(error) && error.code === 'forbidden') {
      return apiFailure('forbidden', requestId);
    }
    logger.log('error', 'calls.ringing_read_failed', { requestId, error });
    return apiFailure('internal', requestId);
  }
}
