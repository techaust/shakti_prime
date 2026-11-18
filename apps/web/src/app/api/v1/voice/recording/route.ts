import { voiceRecordingRoute } from '../../../../../voice/recording';
import { recordingRouteDeps } from '../../../../../voice/route-deps';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/voice/recording` (docs/06-api.md §3.1): the voice worker's upload address for a
 * recorded Teach session's audio, once per session, sent with the session's voice token.
 */
export function POST(request: Request): Promise<Response> {
  return voiceRecordingRoute(request, recordingRouteDeps());
}
