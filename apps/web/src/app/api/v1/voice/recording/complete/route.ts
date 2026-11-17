import { voiceRecordingCompleteRoute } from '../../../../../../voice/recording';
import { recordingRouteDeps } from '../../../../../../voice/route-deps';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/voice/recording/complete` (docs/06-api.md §3.1): the recording landed; it is filed
 * in the Knowledge Vault as the person, Executive only, and linked to the session.
 */
export function POST(request: Request): Promise<Response> {
  return voiceRecordingCompleteRoute(request, recordingRouteDeps());
}
