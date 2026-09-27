import { openIdConfigurationDocument } from '../../../realtime/handlers';

export const dynamic = 'force-dynamic';

/** The BOS as a token issuer: Supabase reads this to find the key list (ADR 0003). */
export function GET(): Response {
  return openIdConfigurationDocument();
}
