import { apiFailure } from '../api-failure';
import { hostedRuntime, localRuntime } from '../auth/deps';
import { incomingRequestId } from '../request-id';
import { WEBHOOK_VERIFIERS } from '../webhooks/providers';
import { receiveWebhook, type WebhookDeps } from '../webhooks/receive';

/**
 * The journeys' ringing phone (docs/03-roadmap-appendix/phase2.md §7.4, as T3's simulated
 * provider is for dialling): `GET /api/v1/calls/simulated-incoming` with the fields Exotel's
 * Passthru applet sends (`CallSid`, `CallFrom`, `CallTo`, `DialWhomNumber`) goes through the very
 * route an inbound call takes (`/api/v1/webhooks/exotel/incoming/:secret`), stored, processed and
 * held for the person rung, with this machine's own secret in place of `EXOTEL_INCOMING_SECRET`.
 *
 * Only a runtime with the local marker (`localRuntime()`: `BOS_ENVIRONMENT=local` on this
 * machine, never on Vercel) answers it; a hosted runtime and a development server without the
 * marker answer that there is no such address, so no deployment ever takes a call from it.
 */
export const SIMULATED_INCOMING_SECRET = 'a simulated incoming call on this machine';

export function simulatedIncoming(
  env: NodeJS.ProcessEnv = process.env,
  deps: Partial<WebhookDeps> = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (hostedRuntime(env) || !localRuntime(env)) {
      return apiFailure('not_found', incomingRequestId(request.headers));
    }
    const receive = receiveWebhook('exotel_incoming', WEBHOOK_VERIFIERS.exotel_incoming, {
      source: 'query',
      deps: { ...deps, env: { ...env, EXOTEL_INCOMING_SECRET: SIMULATED_INCOMING_SECRET } },
    });
    return receive(request, { params: Promise.resolve({ secret: SIMULATED_INCOMING_SECRET }) });
  };
}
