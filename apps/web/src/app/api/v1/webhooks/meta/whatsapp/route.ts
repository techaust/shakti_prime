import { WEBHOOK_VERIFIERS } from '../../../../../../webhooks/providers';
import { metaHandshake, receiveWebhook } from '../../../../../../webhooks/receive';

export const dynamic = 'force-dynamic';
/** Seconds; the answer goes within 2 (docs/03-roadmap-appendix/phase2.md §5.1). */
export const maxDuration = 10;

/**
 * `GET/POST /api/v1/webhooks/meta/whatsapp` (docs/06-api.md §3.4): Meta's subscription check, and
 * WhatsApp's messages, statuses and template updates, signed with `WHATSAPP_APP_SECRET`.
 */
export const GET = metaHandshake('meta_whatsapp', WEBHOOK_VERIFIERS.meta_whatsapp);
export const POST = receiveWebhook('meta_whatsapp', WEBHOOK_VERIFIERS.meta_whatsapp);
