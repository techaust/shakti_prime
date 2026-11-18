import { refreshVoiceTokenRoute } from '../../../../../voice/handlers';
import { tokenRouteDeps } from '../../../../../voice/route-deps';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/voice/token` (docs/06-api.md §3.1): the voice worker's new 5-minute token for its
 * live session, from its current one, sent as `Authorization: Bearer`.
 */
export function POST(request: Request): Promise<Response> {
  return refreshVoiceTokenRoute(request, tokenRouteDeps());
}
