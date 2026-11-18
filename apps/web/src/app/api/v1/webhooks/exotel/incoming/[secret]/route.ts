import { WEBHOOK_VERIFIERS } from '../../../../../../../webhooks/providers';
import { receiveWebhook } from '../../../../../../../webhooks/receive';

export const dynamic = 'force-dynamic';
/** Seconds; the answer goes within 2 (docs/03-roadmap-appendix/phase2.md §5.1). */
export const maxDuration = 10;

/**
 * `GET/POST /api/v1/webhooks/exotel/incoming/:secret` (docs/06-api.md §3.4): an inbound call from
 * the Passthru applet, which signs nothing, so its address carries `EXOTEL_INCOMING_SECRET`.
 * Passthru calls with GET and the call's fields in the address; a flow set to POST sends them as
 * form fields.
 */
export const GET = receiveWebhook('exotel_incoming', WEBHOOK_VERIFIERS.exotel_incoming, {
  source: 'query',
});
export const POST = receiveWebhook('exotel_incoming', WEBHOOK_VERIFIERS.exotel_incoming);
