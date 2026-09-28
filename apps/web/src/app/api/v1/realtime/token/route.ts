import { currentPrincipal } from '../../../../../auth/current-principal';
import { defaultAuthDeps } from '../../../../../auth/deps';
import { issueRealtimeToken } from '../../../../../realtime/handlers';
import { issueGrantThroughCommand } from '../../../../../realtime/issue';

export const dynamic = 'force-dynamic';

/**
 * A short-lived token for Supabase Realtime, for the signed-in person (ADR 0003, docs/API.md
 * §3.1). The claims come from `realtime.token.issue`, which audits each token, and each person's
 * tokens are capped in the shared store. Bearer tokens from the field app are accepted here once
 * the mobile tokens exist.
 */
export function POST(request: Request): Promise<Response> {
  return issueRealtimeToken(request, {
    principal: currentPrincipal,
    issue: issueGrantThroughCommand,
    keyValue: defaultAuthDeps().keyValue,
  });
}
