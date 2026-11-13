import { WebhookSweepWorkerBody } from '@shakti/contracts';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import { WEBHOOK_SWEEP_PATH } from '../../../../../../workers/qstash';
import { runWebhookSweep } from '../../../../../../workers/webhooks/sweep';

export const dynamic = 'force-dynamic';
/** Seconds: one purge of at most 5,000 payloads and rows, and at most 200 publishes. */
export const maxDuration = 30;

/**
 * The webhook sweep (docs/06-api.md §3.6, docs/03-roadmap-appendix/phase2.md §5.1). Only QStash
 * calls it: the schedule `webhook-sweep-<environment>` every minute with `{}`; the same refusals
 * as the nightly workers (`nightlyWorkerRoute`).
 */
export const POST = nightlyWorkerRoute({
  path: WEBHOOK_SWEEP_PATH,
  job: 'webhook-sweep',
  logPrefix: 'webhooks.sweep',
  body: WebhookSweepWorkerBody,
  budgetMs: 20_000,
  run: (_body, { requestId, budgetMs }) => runWebhookSweep({ requestId, budgetMs }),
});
