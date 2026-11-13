import { WEBHOOK_VERIFIERS } from '../../../../../../webhooks/providers';
import { metaHandshake, receiveWebhook } from '../../../../../../webhooks/receive';

export const dynamic = 'force-dynamic';
/** Seconds; the answer goes within 2 (docs/03-roadmap-appendix/phase2.md §5.1). */
export const maxDuration = 10;

/**
 * `GET/POST /api/v1/webhooks/meta/leadgen` (docs/06-api.md §3.4): Meta's subscription check, and
 * the ids of new Lead Ads leads, signed with `META_LEADGEN_APP_SECRET`.
 */
export const GET = metaHandshake('meta_leadgen', WEBHOOK_VERIFIERS.meta_leadgen);
export const POST = receiveWebhook('meta_leadgen', WEBHOOK_VERIFIERS.meta_leadgen);
