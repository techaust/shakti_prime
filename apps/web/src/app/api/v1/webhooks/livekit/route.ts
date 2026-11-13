import { WEBHOOK_VERIFIERS } from '../../../../../webhooks/providers';
import { receiveWebhook } from '../../../../../webhooks/receive';

export const dynamic = 'force-dynamic';
/** Seconds; the answer goes within 2 (docs/03-roadmap-appendix/phase2.md §5.1). */
export const maxDuration = 10;

/**
 * `POST /api/v1/webhooks/livekit` (docs/06-api.md §3.4): room and participant events, with a JWT
 * from `LIVEKIT_API_SECRET` whose `sha256` claim is the body's.
 */
export const POST = receiveWebhook('livekit', WEBHOOK_VERIFIERS.livekit);
