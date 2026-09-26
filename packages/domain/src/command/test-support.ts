// Helpers for pure runner tests that never touch a transaction.
import { newId, type Principal } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';

export type { Principal };

/** A request context whose transaction is never used; the cast lives here, not in every test. */
export function fakeContext(principal: Principal): RequestContext {
  return {
    principal,
    entityIds: principal.entityIds,
    requestId: newId(),
    tx: undefined as unknown as RequestContext['tx'],
  };
}
