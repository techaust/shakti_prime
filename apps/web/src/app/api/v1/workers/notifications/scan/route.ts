import { NotificationScanWorkerBody } from '@shakti/contracts';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import {
  NOTIFICATION_SCAN_RUN_BUDGET_MS,
  runNotificationScan,
} from '../../../../../../workers/notify/scan';
import { NOTIFICATION_SCAN_PATH } from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; the scan stops taking new batches well before this (`NOTIFICATION_SCAN_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The notification scan (docs/06-api.md §3.6, docs/03-roadmap-appendix/phase1.md §8.1). Only QStash calls it: the
 * schedule `notification-scan-<environment>` every five minutes, and a run handing on the rest
 * (`nightlyWorkerRoute`).
 */
export const POST = nightlyWorkerRoute({
  path: NOTIFICATION_SCAN_PATH,
  logPrefix: 'notifications.due.scan',
  body: NotificationScanWorkerBody,
  budgetMs: NOTIFICATION_SCAN_RUN_BUDGET_MS,
  run: runNotificationScan,
});
