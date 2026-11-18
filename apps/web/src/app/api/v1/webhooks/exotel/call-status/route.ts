import { WEBHOOK_VERIFIERS } from '../../../../../../webhooks/providers';
import { receiveWebhook } from '../../../../../../webhooks/receive';

export const dynamic = 'force-dynamic';
/** Seconds; the answer goes within 2 (docs/03-roadmap-appendix/phase2.md §5.1). */
export const maxDuration = 10;

/**
 * `POST /api/v1/webhooks/exotel/call-status` (docs/06-api.md §3.4): a call's status, on the
 * callback address the BOS signed for that call with `EXOTEL_CALLBACK_SECRET`.
 */
export const POST = receiveWebhook('exotel_status', WEBHOOK_VERIFIERS.exotel_status);
