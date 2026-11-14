import { askRouteDeps } from '../../../../ask/route-deps';
import { askRoute } from '../../../../ask/route';

export const dynamic = 'force-dynamic';
/** A question runs up to five model calls of up to 45 seconds each, and its lookups. */
export const maxDuration = 300;

/** `POST /api/v1/ask` (docs/06-api.md §3.1): one question to Ask the Business, streamed. */
export function POST(request: Request): Promise<Response> {
  return askRoute(request, askRouteDeps());
}
