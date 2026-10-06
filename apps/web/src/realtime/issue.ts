import type { Principal, RealtimeTokenGrant } from '@shakti/contracts';
import { executeCommand, issueRealtimeToken, type ClientMeta } from '@shakti/domain';

/**
 * Settles a Realtime token's claims through `realtime.token.issue`, which writes the audit row
 * (docs/03-roadmap-appendix/backend-weeks-3-5.md §2.6). The companies are the ones the session narrowed the
 * caller to, so the token opens no channel outside them.
 */
export function issueGrantThroughCommand(
  principal: Principal,
  meta: { requestId: string; client: ClientMeta },
): Promise<RealtimeTokenGrant> {
  return executeCommand(
    principal,
    { entityIds: principal.entityIds, requestId: meta.requestId },
    issueRealtimeToken,
    {},
    { client: meta.client },
  );
}
