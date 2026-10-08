import { NotificationScanWorkerResponse, type NotificationScanWorkerBody } from '@shakti/contracts';
import { executeCommand, scanNotices } from '@shakti/domain';
import type { PushSender } from '../../notifications/push';
import {
  companyBatchRunId,
  runCompanyBatches,
  type CompanyBatchOptions,
  type CompanyBatchSpec,
} from '../company-batches';
import { NOTIFICATION_SCAN_PATH } from '../qstash';
import { deliverNoticeBatch } from './deliver-notices';

/**
 * How long one scan keeps starting batches before it hands the rest to a fresh call. A batch reads
 * at most 200 finds of each kind in three statements and pushes the notices it wrote (eight at a
 * time, each push at most five seconds) and the pushes an earlier cut-off left pending. No push is
 * started after the budget; what is left stays pending for the next scan, well inside the route's
 * `maxDuration` of 60 seconds.
 */
export const NOTIFICATION_SCAN_RUN_BUDGET_MS = 30_000;

/** The run's minute, `YYYY-MM-DDTHH:MM` (UTC), naming a five-minute run in its hand-overs. */
export function scanMinute(at: number): string {
  return new Date(at).toISOString().slice(0, 16);
}

function spec(
  sender: PushSender | undefined,
  deadlineAt: number | undefined,
  now: (() => number) | undefined,
): CompanyBatchSpec {
  return {
    runName: 'notification-scan',
    logPrefix: 'notifications.due.scan',
    path: NOTIFICATION_SCAN_PATH,
    async batch(principal, scope, entityId) {
      const found = await executeCommand(principal, scope, scanNotices, { entityId });
      const counts = await deliverNoticeBatch(principal, found, {
        requestId: scope.requestId ?? `notification-scan-${String(entityId)}`,
        sender,
        deadlineAt,
        now,
      });
      // Every find is new (a told reason never comes back), so a full batch that wrote nothing
      // means its finds cannot be told; the run moves on rather than read them again.
      return {
        count: counts.created,
        nextAfterId: found.more && counts.created > 0 ? 'more' : null,
      };
    },
  };
}

/**
 * The notification scan (docs/03-roadmap-appendix/phase1.md §8.1), every five minutes: every company in turn,
 * each batch one `notifications.due.scan` as `system:workers` scoped to that company, whose notices
 * are then pushed (`runCompanyBatches`). It finds what no event announces: calls falling due,
 * quotes about to lapse and first calls running late.
 */
export async function runNotificationScan(
  body: NotificationScanWorkerBody,
  options: CompanyBatchOptions & { sender?: PushSender } = {},
): Promise<NotificationScanWorkerResponse> {
  const started = (options.now ?? Date.now)();
  const result = await runCompanyBatches(
    spec(
      options.sender,
      options.budgetMs === undefined ? undefined : started + options.budgetMs,
      options.now,
    ),
    { ...body, runDate: body.runDate ?? scanMinute(started) },
    options,
  );
  return NotificationScanWorkerResponse.parse({
    batches: result.batches,
    created: result.count,
    done: result.done,
  });
}

/** The queue's deduplication id for a hand-over of the scan (`companyBatchRunId`). */
export function notificationScanRunId(
  body: NotificationScanWorkerBody & { runDate: string },
): string {
  return companyBatchRunId('notification-scan', body);
}
