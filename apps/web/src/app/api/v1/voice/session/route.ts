import { startVoiceSessionRoute } from '../../../../../voice/handlers';
import { sessionRouteDeps } from '../../../../../voice/route-deps';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/voice/session` (docs/06-api.md §3.1): starts a "Talk to Shakti" session for the
 * signed-in person after the recording question, within the day's limits, and answers the
 * LiveKit room, the person's join token and the voice worker's first token.
 */
export function POST(request: Request): Promise<Response> {
  return startVoiceSessionRoute(request, sessionRouteDeps());
}
