import { WEBHOOK_VERIFIERS } from '../../../../../../webhooks/providers';
import { receiveWebhook } from '../../../../../../webhooks/receive';

export const dynamic = 'force-dynamic';
/** Seconds; the answer goes within 2 (docs/03-roadmap-appendix/phase2.md §5.1). */
export const maxDuration = 10;

/**
 * `POST /api/v1/webhooks/google/leadform` (docs/06-api.md §3.4): a Google Ads lead form's lead,
 * carrying the form's key, compared in constant time with `GOOGLE_LEADFORM_KEY`.
 */
export const POST = receiveWebhook('google_leadform', WEBHOOK_VERIFIERS.google_leadform);
