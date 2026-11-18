import { simulatedIncoming } from '../../../../../calls/simulated-incoming';

export const dynamic = 'force-dynamic';

/**
 * The journeys' ringing phone: an inbound call simulated on this machine only (`localRuntime()`);
 * every other runtime answers that there is no such address.
 */
export function GET(request: Request): Promise<Response> {
  return simulatedIncoming()(request);
}
