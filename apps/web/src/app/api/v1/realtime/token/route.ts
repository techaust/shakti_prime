import { currentPrincipal } from '../../../../../auth/current-principal';
import { issueRealtimeToken } from '../../../../../realtime/handlers';

export const dynamic = 'force-dynamic';

/**
 * A short-lived token for Supabase Realtime, for the signed-in person (ADR 0003, docs/API.md
 * §3.1). Bearer tokens from the field app are accepted here once the mobile tokens exist.
 */
export function POST(request: Request): Promise<Response> {
  return issueRealtimeToken(request, { principal: currentPrincipal });
}
