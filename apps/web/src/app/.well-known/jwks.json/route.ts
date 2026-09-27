import { jwksDocument } from '../../../realtime/handlers';

export const dynamic = 'force-dynamic';

/** The BOS public signing keys, which Supabase fetches to verify Realtime tokens (ADR 0003). */
export function GET(): Promise<Response> {
  return jwksDocument();
}
